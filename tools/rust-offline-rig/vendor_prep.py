#!/usr/bin/env python3
"""Rewrite vendored crate manifests into cargo `directory` source format.

Cargo requires a directory source to hold self-contained, path-free manifests. Git
clones do not: they carry `path = ...` dependencies and `workspace = true`
inheritance (crates.io publishes a normalised manifest, a clone does not). This
rewrites each manifest in place: inherited deps get explicit versions, `path` keys
are stripped, `[workspace]` / `[patch.*]` tables are dropped, and a
`.cargo-checksum.json` is written so cargo treats the directory as a registry
replacement.

Dev-dependencies are dropped as well, and any `[features]` entry that only pointed at a
dropped dev-dependency is emptied: cargo parses the features table of *vendored* crates
too, so syn\'s `test = ["syn-test-suite/all-features"]` fails the whole build even though
nothing in the workspace asks for that feature.

Usage: vendor_prep.py <src-dir> <dst-dir>
"""

import json
import os
import re
import shutil
import sys

# (source subdir under <src>, crate name, version)
PLAN = [
    # <source subdir under <src>>, crate name, version — pinned to `Cargo.lock`.
    ("serde-1.0.229/serde", "serde", "1.0.229"),
    ("serde-1.0.229/serde_derive", "serde_derive", "1.0.229"),
    ("serde-1.0.229/serde_core", "serde_core", "1.0.229"),
    ("json-1.0.151", "serde_json", "1.0.151"),
    ("zmij", "zmij", "1.0.23"),
    ("thiserror", "thiserror", "1.0.69"),
    ("thiserror/impl", "thiserror-impl", "1.0.69"),
    ("syn-2.0.119", "syn", "2.0.119"),
    ("syn-3.0.6", "syn-3.0.6", "3.0.6"),
    ("proc-macro2-1.0.107", "proc-macro2", "1.0.107"),
    ("quote-1.0.47", "quote", "1.0.47"),
    ("itoa-1.0.18", "itoa", "1.0.18"),
    ("ryu", "ryu", "1.0.18"),
    ("memchr-2.8.3", "memchr", "2.8.3"),
    ("unicode-ident-1.0.26", "unicode-ident", "1.0.26"),
    ("indexmap", "indexmap", "2.2.6"),
    ("hashbrown", "hashbrown", "0.14.5"),
    ("equivalent", "equivalent", "1.0.2"),
    ("async-trait", "async-trait", "0.1.92"),
    ("anyhow-1.0.104", "anyhow", "1.0.104"),
    ("regex", "regex", "1.13.1"),
    ("regex-automata-0.4.18/regex-automata", "regex-automata", "0.4.18"),
    ("regex-syntax-0.8.11/regex-syntax", "regex-syntax", "0.8.11"),
    ("aho-corasick", "aho-corasick", "1.1.5"),
]
# Fallback versions for `workspace = true` deps whose workspace manifest cannot be read. The
# authoritative source is `[workspace.dependencies]` of the crate's own repository (see
# `workspace_dep_versions`): serde, for instance, pins syn 3 while thiserror keeps syn 2, so a
# single global guess is exactly the kind of thing that silently breaks the build.
DEP_VER = {name: ver for _, name, ver in PLAN}
ALL_CRATES = {name for _, name, _ in PLAN}

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


DEV_SECTION = re.compile(r"^\[dev-dependencies(?:\.([^\]]+))?\]$")


def collect_external_dev_deps(path):
    """Dev-dependency names that are *not* part of the vendored set.

    Those are dropped from the manifest, so any [features] entry that references
    them would leave cargo with a dangling feature (syn's `test` feature is the
    canonical example). Names that are vendored (serde_derive, …) are kept
    because the corresponding [dependencies] entry survives.
    """
    names, in_dev = set(), False
    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            in_dev = stripped.startswith("[dev-dependencies")
            dotted = DEV_SECTION.match(stripped)
            if dotted and dotted.group(1):
                names.add(dotted.group(1))
            continue
        if in_dev and "=" in stripped and not stripped.startswith("#"):
            key = stripped.split("=")[0].strip().strip('"')
            if "package = " in stripped:
                key = stripped.split("package = ")[1].split(",")[0].strip().strip('"')
            if key:
                names.add(key)
    return {n for n in names if n not in ALL_CRATES}


def workspace_dep_versions(repo_root):
    """`[workspace.dependencies]` of a source repository → {name: version requirement}.

    Vendored manifests carry `dep = { workspace = true }`, which a directory source rejects.
    Cargo would fill in the version from that table, so read the table instead of guessing.
    """
    manifest = os.path.join(repo_root, "Cargo.toml")
    if not os.path.isfile(manifest):
        return {}
    versions, in_table, current = {}, False, None
    for line in open(manifest, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
            in_table = section == "workspace.dependencies"
            current = (
                section[len("workspace.dependencies."):]
                if section.startswith("workspace.dependencies.")
                else None
            )
            continue
        if not in_table and not current:
            continue
        if not stripped or stripped.startswith("#"):
            continue
        if current:  # [workspace.dependencies.foo] sub-table
            if stripped.startswith("version"):
                versions[current] = stripped.split("=", 1)[1].strip().strip('"')
            continue
        key = stripped.split("=")[0].strip().strip('"')
        rest = stripped.split("=", 1)[1] if "=" in stripped else ""
        if "version" in rest:
            match = re.search(r'version\s*=\s*"([^"]+)"', rest)
            if match:
                versions[key] = match.group(1)
        elif rest.strip().startswith('"'):
            versions[key] = rest.strip().strip('"')
    return versions


def rewrite_manifest(path, name, version, workspace_deps=None):
    out, drop_section, report = [], False, []
    in_features = False
    dev_deps = collect_external_dev_deps(path)
    for line in open(path, encoding="utf-8").read().split("\n"):
        stripped = line.strip()
        header = SECTION.match(stripped)
        if header:
            section = header.group(1)
            drop_section = (
                section == "workspace"
                or section.startswith("patch.")
                or section.startswith("dev-dependencies")
            )
            in_features = section == "features"
            if drop_section:
                report.append(f"  - dropped table [{section}]")
                continue
            out.append(line)
            continue
        if drop_section:
            continue
        if in_features and "=" in stripped and "[" in stripped:
            key, _, rest = stripped.partition("=")
            refs = re.findall(r'"([^"/]+)', rest)
            if any(r.lstrip("dep:") in dev_deps for r in refs):
                report.append(f"  - feature {key.strip()} referenced a dropped dev-dependency")
                out.append(f"{key.strip()} = []")
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
            requirement = (workspace_deps or {}).get(key) or DEP_VER.get(key)
            if requirement is None:
                report.append(f"  - dropped unknown inherited dep {key}")
                continue
            line = re.sub(r"workspace\s*=\s*true", f'version = "{requirement}"', line)
            report.append(f"  ~ dep {key} workspace -> version {requirement}")
        stripped_path = re.sub(r'^\s*path\s*=\s*"[^"]*"\s*$', "", line)
        stripped_path = re.sub(r',\s*path\s*=\s*"[^"]*"', "", stripped_path)
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
    workspace_cache = {}
    for subdir, name, version in PLAN:
        crate_src = os.path.join(src, subdir)
        if not os.path.isdir(crate_src):
            raise SystemExit(f"FATAL: missing source dir {crate_src}")
        repo_root = os.path.join(src, subdir.split(os.sep)[0])
        if repo_root not in workspace_cache:
            workspace_cache[repo_root] = workspace_dep_versions(repo_root)
        crate_dst = os.path.join(dst, name)
        shutil.copytree(crate_src, crate_dst, ignore=shutil.ignore_patterns(*EXCLUDE))
        print(f"{name} {version}")
        for line in rewrite_manifest(
            os.path.join(crate_dst, "Cargo.toml"), name, version, workspace_cache[repo_root]
        ):
            print(line)
    print(f"vendored {len(PLAN)} crates into {dst}")


if __name__ == "__main__":
    main(sys.argv)
