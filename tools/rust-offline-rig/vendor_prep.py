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
    # TASK-RIG-REPAIR-01 / ISSUE-025: workspace needs indexmap (=2.2.6, Cargo.toml L25)
    # and regex 1.10 (n8n-expression) plus their transitive closure. regex-automata and
    # regex-syntax are vendored from subdirs of the rust-lang/regex tag (their versions
    # at tag 1.10.6).
    ("indexmap", "indexmap", "2.2.6"),
    ("equivalent", "equivalent", "1.0.2"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("regex", "regex", "1.10.6"),
    ("regex/regex-automata", "regex-automata", "0.4.7"),
    ("regex/regex-syntax", "regex-syntax", "0.8.4"),
    ("aho-corasick", "aho-corasick", "1.1.3"),
]

DEP_VER = {name: ver for _, name, ver in PLAN}

# Bump when the rewrite rules change: it is part of the .rig-plan fingerprint
# (TASK-RIG-VENDOR-01), so rule edits re-vendor instead of silently reusing
# output produced by older rules.
REWRITE_REV = 1

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

SECTION = re.compile(r"^\[([^\]]+)\]$")
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")


def rewrite_manifest(path, name, version):
    # section-style `[dependencies.x]` / `path = "..."` lines and `[[test]]` stanzas
    # pointing into EXCLUDEd dirs exist in workspace-shaped repos (e.g. rust-lang/regex
    # at tag 1.10.6); TASK-RIG-REPAIR-01 / ISSUE-025.
    out, report = [], []
    lines = open(path, encoding="utf-8").read().split("\n")
    i = 0
    dep_section = False
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("["):
            inner = stripped.strip("[]")
            if inner == "workspace" or inner.startswith("patch."):
                report.append(f"  - dropped table {stripped}")
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("["):
                    i += 1
                continue
            if inner.split(".")[0] in ("test", "bench", "example"):
                j = i + 1
                stanza = [lines[i]]
                while j < len(lines) and not lines[j].strip().startswith("["):
                    stanza.append(lines[j])
                    j += 1
                if any(re.match(r'\s*path\s*=\s*"(tests|benches|examples|fuzz)/', ln) for ln in stanza):
                    report.append(f"  - dropped {inner} stanza (points into excluded dir)")
                else:
                    out.extend(stanza)
                i = j
                continue
            dep_section = inner.split(".")[0] in ("dependencies", "dev-dependencies", "build-dependencies")
            out.append(lines[i])
            i += 1
            continue
        if dep_section and re.match(r'\s*path\s*=\s*"[^"]*"\s*$', lines[i]):
            report.append("  - dropped section-style path dependency")
            i += 1
            continue
        if not stripped or stripped.startswith("#"):
            out.append(lines[i])
            i += 1
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
            i += 1
            continue
        if re.search(r"workspace\s*=\s*true", lines[i]):
            key = stripped.split("=")[0].strip()
            if key not in DEP_VER:
                report.append(f"  - dropped unknown inherited dep {key}")
                i += 1
                continue
            lines[i] = re.sub(r"workspace\s*=\s*true", f'version = "{DEP_VER[key]}"', lines[i])
            report.append(f"  ~ dep {key} workspace -> version {DEP_VER[key]}")
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", lines[i])
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"\s*,\s*', "", stripped_path)
        if stripped_path != lines[i]:
            report.append("  ~ stripped a path dependency")
        out.append(stripped_path)
        i += 1
    body = "\n".join(out)
    if "workspace = true" in body or re.search(r'(?m)^\s*path\s*=\s*"', body):
        raise SystemExit(f"FATAL: {name}: manifest still has workspace/path remnants")
    open(path, "w", encoding="utf-8").write(body)
    with open(os.path.join(os.path.dirname(path), ".cargo-checksum.json"), "w") as fh:
        json.dump({"files": {}}, fh)
    return report

def main(argv):
    if len(argv) != 3:
        raise SystemExit(__doc__.strip().splitlines()[-1])
    src, dst = argv[1], argv[2]
    # Staleness gate (single source of truth = PLAN + REWRITE_REV): an existing
    # vendor dir is only reused when built from exactly this plan, so PLAN edits
    # take effect on old rigs (e.g. pre-repair 12-crate vendors) without manual
    # wipes (TASK-RIG-VENDOR-01).
    fingerprint = f"rev={REWRITE_REV}\n" + "\n".join(
        f"{subdir}@{name}@{version}" for subdir, name, version in PLAN
    )
    marker = os.path.join(dst, ".rig-plan")
    if os.path.isfile(marker) and open(marker, encoding="utf-8").read() == fingerprint:
        print(f"vendor up to date ({len(PLAN)} crates)")
        return
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
    with open(marker, "w", encoding="utf-8") as fh:
        fh.write(fingerprint)
    print(f"vendored {len(PLAN)} crates into {dst}")


if __name__ == "__main__":
    main(sys.argv)
