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
    ("indexmap", "indexmap", "2.2.6"),
    ("equivalent", "equivalent", "1.0.1"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("aho-corasick", "aho-corasick", "1.1.3"),
    ("regex/regex-automata", "regex-automata", "0.4.7"),
    ("regex/regex-syntax", "regex-syntax", "0.8.4"),
    ("regex", "regex", "1.10.6"),
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

# Plain tables [x] and array-of-tables [[x]] alike — [[bench]] / [[test]] /
# [[example]] / [[bin]] carry their own `path` keys and must be recognized too.
SECTION = re.compile(r"^\[+([^\]]+)\]+$")
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")


def collect_devdeps(lines):
    """First pass: dependency names declared inside dropped [dev-dependencies]
    sections (incl. dotted forms like [dev-dependencies.env_logger]). Features
    may reference them (`test = ["syn-test-suite/all-features"]`); once the
    dev-dep is dropped the feature reference is orphaned and cargo rejects the
    manifest, so the second pass prunes those lines — but ONLY when the name is
    not also a real (kept) dependency, because test setups often re-declare the
    crate's own optional deps as dev-deps (serde_derive, memchr, ...)."""
    devdeps, realdeps = set(), set()
    in_dev = in_real = False
    for line in lines:
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
            in_dev = section == "dev-dependencies" or section.startswith("dev-dependencies.")
            in_real = (
                section == "dependencies"
                or section.startswith("dependencies.")
                or section == "build-dependencies"
                or section.startswith("build-dependencies.")
            )
            continue
        if in_dev or in_real:
            m = re.match(r"^([A-Za-z0-9_-]+)\s*=", stripped)
            if m:
                (devdeps if in_dev else realdeps).add(m.group(1))
    return devdeps - realdeps


def rewrite_manifest(path, name, version):
    raw_lines = open(path, encoding="utf-8").read().split("\n")
    devdeps = collect_devdeps(raw_lines)
    out, drop_section, report = [], False, []
    for line in raw_lines:
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
            # Tables that are meaningless or harmful in a directory source:
            # [workspace]/[patch.*] (inheritance), [dev-dependencies] plus
            # [[bench]]/[[test]]/[[example]] (may carry path deps), [target.*]
            # (platform-specific dev-deps), [badges] (retired metadata).
            drop_section = (
                section == "workspace"
                or section == "dev-dependencies"
                or section.startswith("dev-dependencies.")
                or section == "badges"
                or section.startswith("patch.")
                or section.startswith("target.")
                or section.split(".")[0] in ("bench", "test", "example")
            )
            if drop_section:
                report.append(f"  - dropped table [{section}]")
                continue
            out.append(line)
            continue
        if drop_section:
            continue
        # Surgically prune feature ARRAY ITEMS that reference a dropped dev-dep
        # (e.g. syn's `test = ["syn-test-suite/all-features"]`, hashbrown's
        # `nightly = ["allocator-api2?/nightly", "bumpalo/allocator_api"]` — keep
        # the real-dep item, drop only the dev-dep item; dropping the whole line
        # is wrong because other features may reference the feature itself).
        if section == "features" and devdeps and "[" in line:
            open_i = line.index("[")
            close_i = line.rfind("]")
            if close_i > open_i:
                head, inner, tail = line[: open_i + 1], line[open_i + 1 : close_i], line[close_i:]

                def orphaned(item):
                    core = item.strip().strip('"').split("?")[0].split("/")[0]
                    return core in devdeps

                items = [i.strip() for i in inner.split(",") if i.strip()]
                kept = [i for i in items if not orphaned(i)]
                if len(kept) != len(items):
                    report.append(f"  - pruned orphaned feature item(s): {stripped[:70]}")
                line = head + ", ".join(kept) + tail
        if not stripped or stripped.startswith("#"):
            out.append(line)
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
        # Standalone `path = "..."` lines inside dependency tables: drop the line
        # entirely (the versioned dep still resolves from the vendor directory).
        if (
            section.startswith("dependencies")
            or section.startswith("build-dependencies")
        ) and re.match(r'^path\s*=\s*"[^"]*"\s*$', stripped):
            report.append(f"  - dropped path-only line in [{section}]")
            continue
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", line)
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"\s*,\s*', "", stripped_path)
        if stripped_path != line:
            report.append("  ~ stripped a path dependency")
        out.append(stripped_path)
    body = "\n".join(out)
    if "workspace = true" in body or re.search(r'path\s*=\s*"', body):
        raise SystemExit(f"FATAL: {name}: manifest still has workspace/path remnants")
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
