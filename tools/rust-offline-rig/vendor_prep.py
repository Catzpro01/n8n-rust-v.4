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
# Keep this list in sync with CRATES in setup.sh. Workspace crates depend on
# indexmap and regex, so their runtime dependency closure is vendored too.
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
    ("aho-corasick", "aho-corasick", "1.1.3"),
    ("unicode-ident", "unicode-ident", "1.0.14"),
    ("equivalent", "equivalent", "1.0.1"),
    ("hashbrown", "hashbrown", "0.14.1"),
    ("indexmap", "indexmap", "2.2.6"),
    ("regex/regex-syntax", "regex-syntax", "0.8.4"),
    ("regex/regex-automata", "regex-automata", "0.4.7"),
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

# Match both normal tables (`[dependencies]`) and array tables
# (`[[test]]`). Test/dev-only tables are not needed when compiling a crate as a
# directory dependency, and often point at source files excluded from the rig.
SECTION = re.compile(r"^\[+([^\]]+)\]+$")
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")


def rewrite_manifest(path, name, version):
    out, drop_section, report = [], False, []
    current_section = ""
    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
            current_section = section
            drop_section = (
                section == "workspace"
                or section.startswith("patch.")
                or section == "dev-dependencies"
                or section.startswith("dev-dependencies.")
                or section.endswith(".dev-dependencies")
                or section in {"test", "bench", "example"}
            )
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
        # syn exposes a `test` feature only for its excluded dev-only
        # syn-test-suite workspace member. Keep the feature name for manifest
        # compatibility but make it inert in the production-only rig.
        if current_section == "features" and stripped == 'test = ["syn-test-suite/all-features"]':
            out.append("test = []")
            report.append("  - made syn test feature inert (dev-only workspace member)")
            continue
        if current_section == "features" and stripped == 'nightly = ["allocator-api2?/nightly", "bumpalo/allocator_api"]':
            out.append('nightly = ["allocator-api2?/nightly"]')
            report.append("  - removed hashbrown dev-only bumpalo feature reference")
            continue
        # Some workspace manifests use `workspace = ".."` rather than the
        # inherited `key.workspace = true` form. It has no meaning in a
        # standalone directory source.
        if re.match(r"^workspace\s*=", stripped):
            report.append("  - dropped workspace link")
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
        # Remove path fields only from dependency declarations. `[lib] path =
        # "src/lib.rs"` is a legitimate package-local source path and must
        # stay. Inline dependency tables are handled by removing the field;
        # dependency subtables have a standalone `path =` line.
        if current_section.startswith("dependencies") and re.match(r"^path\s*=", stripped):
            report.append("  ~ stripped a path dependency")
            continue
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", line)
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"\s*,\s*', "", stripped_path)
        if stripped_path != line:
            report.append("  ~ stripped a path dependency")
        out.append(stripped_path)
    body = "\n".join(out)
    if "workspace = true" in body or re.search(r'(?m)^\s*path\s*=\s*"\.\./', body):
        raise SystemExit(f"FATAL: {name}: manifest still has workspace/path dependency remnants")
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
