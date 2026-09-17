#!/usr/bin/env python3
"""Regenerate the Rust golden test file from fixtures + Node reference output.

Usage (from repo root):
    python3 tests/compatibility/gen_rust_golden.py

Steps performed:
    1. Run the Node reference harness (verbatim original n8n functions) on
       every fixture in tests/compatibility/fixtures/
       → tests/compatibility/golden/<name>.expected.txt
    2. Emit tools/n8n-workflow-compat/tests/compat_golden.rs embedding each
       fixture and its expected output as byte-exact raw strings.

Requires: node >= 18 (no npm packages).
"""

import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
COMPAT = os.path.join(ROOT, "tests", "compatibility")
FIXTURES = os.path.join(COMPAT, "fixtures")
GOLDEN = os.path.join(COMPAT, "golden")
HARNESS = os.path.join(COMPAT, "reference", "harness.mjs")
OUT = os.path.join(ROOT, "tools", "n8n-workflow-compat", "tests", "compat_golden.rs")

HEADER = '''//! Differential golden tests: Rust crate vs ORIGINAL n8n behavior.
//!
//! Each fixture below is byte-identical to `tests/compatibility/fixtures/<name>.json`
//! and each expected output is byte-identical to
//! `tests/compatibility/golden/<name>.expected.txt`, which was produced by the
//! Node.js reference harness (`tests/compatibility/reference/harness.mjs`)
//! running the VERBATIM original n8n graph functions.
//!
//! These tests make `cargo test` a self-contained compatibility gate:
//! if the Rust port ever drifts from the original n8n behavior, this suite
//! fails. Regeneration procedure: see `tests/compatibility/README.md`.
//!
//! DO NOT EDIT BY HAND — regenerate with `tests/compatibility/gen_rust_golden.py`.

fn check(name: &str, fixture: &str, expected: &str) {
    let actual = n8n_workflow_compat::compat_engine::run_fixture(fixture)
        .unwrap_or_else(|e| panic!("fixture `{name}` failed to run: {e}"));
    assert_eq!(
        actual, expected,
        "fixture `{name}`: Rust output diverges from original n8n reference"
    );
}

'''


def main() -> int:
    os.makedirs(GOLDEN, exist_ok=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    names = sorted(f[:-5] for f in os.listdir(FIXTURES) if f.endswith(".json"))
    if not names:
        print("no fixtures found", file=sys.stderr)
        return 1

    parts = [HEADER]
    for name in names:
        fixture_path = os.path.join(FIXTURES, name + ".json")
        golden_path = os.path.join(GOLDEN, name + ".expected.txt")

        proc = subprocess.run(
            ["node", HARNESS, fixture_path],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print(f"reference harness FAILED on {name}:\n{proc.stderr}", file=sys.stderr)
            return 1
        expected = proc.stdout.rstrip("\n")
        with open(golden_path, "w") as f:
            f.write(proc.stdout)

        with open(fixture_path) as f:
            fixture = f.read().rstrip("\n")

        for label, content in (("fixture", fixture), ("expected", expected)):
            if "#" in content:
                print(f"raw-string delimiter collision in {name} {label}", file=sys.stderr)
                return 1

        parts.append(
            "\n#[test]\n"
            f"fn golden_{name.replace('-', '_')}() {{\n"
            "    check(\n"
            f'        "{name}",\n'
            f'        r#"{fixture}"#,\n'
            f'        r#"{expected}"#,\n'
            "    );\n"
            "}\n"
        )

    with open(OUT, "w") as f:
        f.write("".join(parts))
    print(f"regenerated {os.path.relpath(OUT, ROOT)} ({len(names)} fixtures, golden outputs re-verified)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
