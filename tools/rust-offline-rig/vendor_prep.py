#!/usr/bin/env python3
"""Rewrite vendored crate manifests into cargo `directory` source format.

Cargo requires a directory source to hold self-contained, path-free manifests. Git
clones do not: they carry `path = ...` dependencies and `workspace = true`
inheritance (crates.io publishes a normalised manifest, a clone does not). This
rewrites each manifest in place: inherited deps get explicit versions, `path` keys
are stripped, `[workspace]` / `[patch.*]` tables are dropped, and a
`.cargo-checksum.json` is written so cargo treats the directory as a registry
replacement.

Usage: vendor_prep.py <src-dir> <dst-dir>
"""

import json
import os
import re
import shutil
import sys

# (source subdir under <src>, crate name, version)
PLAN = [
    ("serde/serde", "serde", "1.0.219"),
    ("serde/serde_derive", "serde_derive", "1.0.219"),
    ("json", "serde_json", "1.0.140"),
    ("thiserror", "thiserror", "1.0.69"),
    ("thiserror/impl", "thiserror-impl", "1.0.69"),
    ("syn", "syn", "2.0.100"),
    ("proc-macro2", "proc-macro2", "1.0.92"),
    ("quote", "quote", "1.0.37"),
    ("itoa", "itoa", "1.0.14"),
    ("ryu", "ryu", "1.0.18"),
    ("memchr", "memchr", "2.7.4"),
    ("unicode-ident", "unicode-ident", "1.0.14"),
    # 2026-09-17: indexmap + regex dependency closures.
    # (main's tested closure + session-01a0ac85 defensive hashbrown-default
    #  feature closure: ahash/foldhash/zerocopy family — inert unless a future
    #  feature set enables hashbrown's default features.)
    ("indexmap", "indexmap", "2.2.6"),
    ("equivalent", "equivalent", "1.0.1"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("allocator-api2", "allocator-api2", "0.2.18"),
    ("aHash", "ahash", "0.8.11"),
    ("foldhash", "foldhash", "0.1.4"),
    ("zerocopy", "zerocopy", "0.7.35"),
    ("zerocopy/zerocopy-derive", "zerocopy-derive", "0.7.35"),
    ("byteorder", "byteorder", "1.5.0"),
    ("cfg-if", "cfg-if", "1.0.0"),
    ("libc", "libc", "0.2.155"),
    ("once_cell", "once_cell", "1.19.0"),
    ("version_check", "version_check", "0.9.4"),
    ("getrandom", "getrandom", "0.2.15"),
    ("regex", "regex", "1.11.1"),
    ("regex/regex-automata", "regex-automata", "0.4.9"),
    ("regex/regex-syntax", "regex-syntax", "0.8.5"),
    ("aho-corasick", "aho-corasick", "1.1.3"),
]

DEP_VER = {name: ver for _, name, ver in PLAN}

EXCLUDE = [
    ".git", "tests", "benches", "fuzz", "examples", "test_suite", ".github",
    "node_modules", "target", "rust-toolchain.toml", "rust-toolchain",
]

# Fields crates inherit from their workspace root; values mirror the upstream workspaces.
PKG_FIELDS = {
    "edition": 'edition = "2021"',
    "license": 'license = "MIT OR Apache-2.0"',
    "rust-version": 'rust-version = "1.61"',
    "readme": 'readme = "README.md"',
    "authors": "authors = []",
    "keywords": "keywords = []",
    "categories": "categories = []",
    "include": "include = []",
    "documentation": 'documentation = "https://docs.rs"',
    "homepage": 'homepage = "https://docs.rs"',
}

SECTION = re.compile(r"^\[+\s*([^\]]+)\s*\]+$")
TARGET_SECTION = re.compile(r"^\[\[(test|bench|example|bin)\]\]$")
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")
STANDALONE_PATH = re.compile(r'^path\s*=\s*"')
# Target sections ([[test]], [[bench]], [[example]], [[bin]]) are irrelevant to a
# vendored build (their sources are excluded anyway) and carry `path = ...` keys
# that are *not* dependency paths, so they are dropped wholesale.
TARGET_SECTION = re.compile(r"^\[\[(test|bench|example|bin)\]\]$")



def is_dep_section(section_name):
    """True for any [dependencies] / [target.*.dependencies] style section."""
    return "dependencies" in section_name


def rewrite_manifest(path, name, version):
    out, drop_section, report = [], False, []

    section_name = "package"
    dropped_deps = []
    DEPSUB = re.compile(r'^((dev|build)?-dependencies)\.([A-Za-z0-9_-]+)$')
    pending = None

    def flush_pending():
        nonlocal pending
        if pending is None:
            return
        hdr, hname, lines = pending
        pending = None
        body_lines = [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]
        if body_lines and all(re.match(r'^path\s*=\s*"[^"]*"\s*$', l) for l in body_lines):
            report.append(f"  - dropped path-only dep subtable [{hname}]")
        else:
            out.append(hdr)
            out.extend(lines)


    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            flush_pending()
            section = header.group(1)
            drop_section = (
                section == "workspace"
                or section.startswith("patch.")
                or TARGET_SECTION.match(stripped) is not None

            )
            if drop_section:
                report.append(f"  - dropped table [{section}]")
                continue
            if DEPSUB.match(section):
                pending = (line, section, [])
            else:
                out.append(line)
            section_name = section
            continue
        if pending is not None:
            pending[2].append(line)
            continue
        if drop_section:
            continue
        if not stripped or stripped.startswith("#"):
            out.append(line)
            continue
        # Standalone `path = "..."` line in a dependency section: strip
        # (the subtable header for a path-only dep is dropped by flush_pending).
        if re.match(r'^path\s*=\s*"[^"]*"\s*$', stripped) and is_dep_section(section_name):
            report.append("  - stripped a standalone path dependency")
            continue
        dotted = DOTTED.match(stripped)
        if dotted:
            field = dotted.group(1)
            if field == "version":
                out.append(f'version = "{version}"')
            elif field in PKG_FIELDS:
                out.append(PKG_FIELDS[field])
            else:
                report.append(f"  - dropped unknown inherited field {field}")
            continue
        if re.search(r"workspace\s*=\s*true", line):
            key = stripped.split("=")[0].strip()
            if key not in DEP_VER:
                report.append(f"  - dropped unknown inherited dep {key}")
                continue
            line = re.sub(r"workspace\s*=\s*true", f'version = "{DEP_VER[key]}"', line)
            report.append(f"  ~ dep {key} workspace -> version {DEP_VER[key]}")
        in_dep_section = section.startswith("dependencies")
        if STANDALONE_PATH.match(stripped) and in_dep_section:
            # table-style dependency `path = "..."` on its own line
            report.append("  - dropped a table-style path key")
            continue
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", line)
        stripped_path = re.sub(r'\{\s*path\s*=\s*"[^"]*"\s*\}', "{ }", stripped_path)
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"\s*,\s*', "", stripped_path)
        if stripped_path != line:
            report.append("  ~ stripped a path dependency")
        pm = re.match(r'^([A-Za-z0-9_-]+)\s*=\s*\{\s*\}\s*$', stripped_path)
        if pm:
            dropped_deps.append(pm.group(1))
            report.append(f"  - dropped path-only dependency {pm.group(1)}")
            continue
        if re.search(r'path\s*=\s*"', stripped_path) and is_dep_section(section_name):
            raise SystemExit(f"FATAL: {name}: path dependency survives in [{section_name}]")
        if is_dep_section(section_name):
            tm = re.match(r'^([A-Za-z0-9_-]+)\s*=\s*\{([^}]*)\}\s*$', stripped_path)
            if tm and "version" not in tm.group(2):
                depname = tm.group(1)
                if depname in DEP_VER:
                    stripped_path = f'{depname} = {{ version = "{DEP_VER[depname]}", {tm.group(2)} }}'
                    report.append(f"  ~ injected version {DEP_VER[depname]} for {depname}")
                elif section_name.startswith("dev-dependencies") or section_name.startswith("build-dependencies") or section_name.startswith("target."):
                    report.append(f"  - dropped unresolvable dev dependency {depname}")
                    continue
        out.append(stripped_path)
    flush_pending()
    body = "\n".join(out)
    if "workspace = true" in body:
        raise SystemExit(f"FATAL: {name}: manifest still has workspace inheritance")
    if dropped_deps:
        body_lines, in_features, cleaned = body.split("\n"), False, []
        for l in body_lines:
            st = l.strip()
            h = SECTION.match(st)
            if h:
                in_features = h.group(1) == "features"
            elif in_features and "=" in st and any(
                re.search(rf"\b{re.escape(d)}\b", st) for d in dropped_deps
            ):
                report.append(f"  - dropped orphaned feature line: {st}")
                continue
            cleaned.append(l)
        body = "\n".join(cleaned)
    open(path, "w", encoding="utf-8").write(body)
    with open(os.path.join(os.path.dirname(path), ".cargo-checksum.json"), "w") as fh:
        json.dump({"files": {}}, fh)
    return report


def main(argv):
    if len(argv) != 3:
        raise SystemExit(__doc__.strip().splitlines()[-1])
    src, dst = argv[1], argv[2]
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    for subdir, name, version in PLAN:
        crate_src = os.path.join(src, subdir)
        if not os.path.isdir(crate_src):
            raise SystemExit(f"FATAL: missing source dir {crate_src}")
        crate_dst = os.path.join(dst, name)
        shutil.copytree(crate_src, crate_dst, ignore=shutil.ignore_patterns(*EXCLUDE))
        print(f"{name} {version}")
        for line in rewrite_manifest(os.path.join(crate_dst, "Cargo.toml"), name, version):
            print(line)
    print(f"vendored {len(PLAN)} crates into {dst}")


if __name__ == "__main__":
    main(sys.argv)
