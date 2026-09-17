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
    ("anyhow", "anyhow", "1.0.98"),
    ("indexmap", "indexmap", "2.2.6"),
    ("petgraph", "petgraph", "0.6.5"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("fixedbitset", "fixedbitset", "0.4.2"),
    ("equivalent", "equivalent", "1.0.1"),
    ("regex", "regex", "1.10.0"),
    ("regex-automata", "regex-automata", "0.4.0"),
    ("regex-syntax", "regex-syntax", "0.8.0"),
    ("aho-corasick", "aho-corasick", "1.1.0"),
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
DOTTED = re.compile(r"^([A-Za-z0-9_.-]+)\.workspace\s*=\s*true$")


def rewrite_manifest(path, name, version):
    out, drop_section, report = [], False, []
    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
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
        # Skip pure path lines like: path = "regex-automata"
        if re.match(r'^path\s*=\s*"[^"]*"\s*$', stripped):
            report.append("  ~ stripped a path dependency (pure path line)")
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
        # Force version for top-level package to match PLAN
        if stripped.startswith("version =") and out and "[package]" in "\n".join(out[-10:]):
            # Only rewrite if this is the package version (first version after [package])
            # Check if we haven't already rewritten version in this file
            if not any('version = "' in l and name in l.lower() for l in out[-20:]):
                # Actually, just rewrite any version = "x" that is in [package] section and before [dependencies]
                # Simpler: if name matches and version is different, rewrite
                if f'version = "{version}"' not in line:
                    # Keep original if it's same major, but for regex we need exact
                    if name in ["regex", "regex-automata", "regex-syntax", "aho-corasick", "indexmap", "petgraph", "hashbrown", "fixedbitset", "anyhow", "equivalent"]:
                        out.append(f'version = "{version}"')
                        report.append(f"  ~ forced version {version} for {name}")
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
        stripped_path = re.sub(r'path\s*=\s*"[^"]*"', "", stripped_path)
        if stripped_path != line:
            report.append("  ~ stripped a path dependency")
            line = stripped_path
            if not line.strip():
                continue
        out.append(line)
    body = "\n".join(out)
    # Final check: allow path remnants if they are in comments or dev-dependencies that we drop? 
    # For now, only check for path in [dependencies] sections
    # Simple check: if "path =" still exists in dependencies, fail
    # But we have stripped all path lines, so check remaining
    if re.search(r'^\s*path\s*=\s*"', body, re.MULTILINE):
        # Only fail if not in dev-dependencies (we keep dev-deps stripped via drop? Actually we don't drop dev-deps)
        # For regex, we have path in [dependencies.regex-automata] which we stripped, but also in [dev-dependencies] regex-test
        # We should drop dev-dependencies table as well for offline rig
        if "[dev-dependencies]" in body:
            # Remove dev-dependencies sections
            lines = body.split("\n")
            new_lines = []
            in_dev = False
            for l in lines:
                if l.strip().startswith("[dev-dependencies"):
                    in_dev = True
                    continue
                if in_dev and l.strip().startswith("["):
                    in_dev = False
                if not in_dev:
                    new_lines.append(l)
            body = "\n".join(new_lines)
    if "workspace = true" in body or re.search(r'^\s*path\s*=\s*"', body, re.MULTILINE):
        raise SystemExit(f"FATAL: {name}: manifest still has workspace/path remnants\n{body[:500]}")
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
