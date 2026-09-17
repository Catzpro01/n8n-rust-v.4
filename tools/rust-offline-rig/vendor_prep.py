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
    # TASK-401: indexmap closure (indexmap 2.2.6 pins hashbrown 0.14 with
    # default-features = false, so ahash is never in the resolve graph) and
    # the regex 1.10 closure (regex-syntax 0.8.5 satisfies both regex ^0.8.2
    # and regex-automata 0.4.9's ^0.8.5; log/arbitrary stay optional).
    ("indexmap", "indexmap", "2.2.6"),
    ("equivalent", "equivalent", "1.0.2"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("regex-1.10.6", "regex", "1.10.6"),
    ("regex-automata-0.4.9/regex-automata", "regex-automata", "0.4.9"),
    ("regex-syntax-0.8.5/regex-syntax", "regex-syntax", "0.8.5"),
    ("aho-corasick", "aho-corasick", "1.1.5"),
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

SECTION = re.compile(r"^\[([^\]]+)\]$")
HDR = re.compile(r"^\[(\[?)([A-Za-z0-9_.-]+)\]\]?$")
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")
BARE_PATH = re.compile(r"^path\s*=\s*\"[^\"]*\"\s*(#.*)?$")
TARGET_SECTIONS = ("lib", "bin", "test", "bench", "example")


def rewrite_manifest(path, name, version):
    out, drop_section, report, section = [], False, [], ""
    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        hdr = HDR.match(stripped)
        if header or hdr:
            section = header.group(1) if header else hdr.group(2)
            drop_section = section == "workspace" or section.startswith("patch.")
            if drop_section:
                report.append(f"  - dropped table [{section}]")
                continue
            out.append(line)
            continue
        if drop_section:
            continue
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
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", line)
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"\s*,\s*', "", stripped_path)
        if stripped_path != line:
            report.append("  ~ stripped a path dependency")
            line = stripped_path
        # Bare `path = "..."` lines (multi-line [dependencies.x] tables, as in
        # the regex family) carry no version on the same line, so the inline
        # strips above cannot see them — drop the whole line instead.
        if BARE_PATH.match(line.strip()) and section.split(".")[0] in (
            "dependencies", "dev-dependencies", "build-dependencies",
        ):
            report.append(f"  - dropped bare path line in [{section}]")
            continue
        out.append(line)
    # Backstop: `path =` is legal inside target sections ([lib], [[test]], ...)
    # where it points at a source file, so only flag it elsewhere. Comment-only
    # lines are ignored (they can legitimately mention either keyword).
    bad, cur = [], ""
    for line in out:
        s = line.strip()
        h = HDR.match(s) or SECTION.match(s)
        if h:
            cur = (h.group(2) if h.re is HDR else h.group(1)).split(".")[0]
            continue
        if not s or s.startswith("#") or cur in TARGET_SECTIONS:
            continue
        if "workspace = true" in s or re.search(r'path\s*=\s*"', s):
            bad.append(s)
    if bad:
        raise SystemExit(f"FATAL: {name}: manifest still has workspace/path remnants: {bad[:3]}")
    open(path, "w", encoding="utf-8").write("\n".join(out))
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
