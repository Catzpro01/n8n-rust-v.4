#!/usr/bin/env python3
"""Phase-3 Rust conformance audit (Stage 2b of run_gate.sh).

The Phase-2 guard could only answer one question: "does `crates/` exist?" In Phase 3 that answer
is permanently yes, so it stops being a gate. What still matters — and what this audit checks
statically, so it runs with or without a Rust toolchain — is whether the port is *tied to the
reference*:

  R1  every crate that ships behaviour has at least one test reading `tests/reference/**`
  R2  fixture paths resolve from the crate manifest dir (`CARGO_MANIFEST_DIR` or a correct
      relative path), not from an assumed CWD
  R3  no escaped-quote corruption (`\\"`) survived into a `.rs` file
  R4  no silent skip: a test must not `return` early when a fixture is absent
  R5  at least one crate exercises a NEGATIVE fixture (`tests/reference/*-invalid/`)

R5 is the one that matters most. A suite built only from positive fixtures cannot fail, so it
cannot be evidence — a `detect_cycles` hardcoded to `Ok(())` would pass it.

Reported, never auto-fixed. Exit 0 only when every applicable check passes.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CRATES = os.path.join(ROOT, "crates")
REFERENCE = os.path.join(ROOT, "tests", "reference")


def crate_dirs():
    if not os.path.isdir(CRATES):
        return []
    return sorted(
        os.path.join(CRATES, d)
        for d in os.listdir(CRATES)
        if os.path.isfile(os.path.join(CRATES, d, "Cargo.toml"))
    )


def rust_files(crate):
    out = []
    for base in ("src", "tests"):
        root = os.path.join(crate, base)
        if not os.path.isdir(root):
            continue
        for dp, _dn, fn in os.walk(root):
            for f in fn:
                if f.endswith(".rs"):
                    out.append(os.path.join(dp, f))
    return sorted(out)


def negative_fixtures():
    """Directories under tests/reference that hold a NEGATIVE case.

    Convention: the directory name contains `-invalid`. A trailing-only match is not enough —
    `06-invalid-connection-type` puts the marker in the middle, and silently classifying it as
    positive would let a rule that accepts everything pass.
    """
    if not os.path.isdir(REFERENCE):
        return []
    return sorted(
        d for d in os.listdir(REFERENCE)
        if "-invalid" in d and os.path.isdir(os.path.join(REFERENCE, d))
    )



def escaped_quotes_in_raw_strings(paths):
    """Yield (relative-path, line-number) for `\\"` found inside a Rust raw string literal.

    Outside a raw string `\\"` is an ordinary escape and says nothing; inside `r"..."` /
    `r#"..."#` the backslash is literal, so the JSON the test compares against is wrong.
    """
    results = []
    for path in paths:
        text = open(path, encoding="utf8", errors="replace").read()
        in_raw = False
        hashes = 0
        line = 1
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\n":
                line += 1
                i += 1
                continue
            if not in_raw:
                if ch == 'r' and i + 1 < len(text) and text[i + 1] in '"#':
                    j = i + 1
                    count = 0
                    while j < len(text) and text[j] == '#':
                        count += 1
                        j += 1
                    if j < len(text) and text[j] == '"':
                        in_raw = True
                        hashes = count
                        i = j + 1
                        continue
                i += 1
                continue
            # inside a raw string: look for the closing delimiter
            if ch == '"':
                closing = text[i + 1:i + 1 + hashes]
                if closing == '#' * hashes:
                    in_raw = False
                    i += 1 + hashes
                    continue
            if ch == '\\' and i + 1 < len(text) and text[i + 1] == '"':
                results.append((os.path.relpath(path, ROOT), line))
                i += 2
                continue
            i += 1
    return results


def audit():
    print("=== [AGENT 5] RUST CONFORMANCE AUDIT (Phase 3, static) ===\n")
    crates = crate_dirs()
    if not crates:
        print("  no crates/ workspace — nothing to audit")
        return 0

    negatives = negative_fixtures()
    findings = []
    usable = 0

    for crate in crates:
        name = os.path.basename(crate)
        files = rust_files(crate)
        tests = [f for f in files if os.sep + "tests" + os.sep in f]
        sources = [f for f in files if os.sep + "src" + os.sep in f]
        if not sources:
            print(f"  {name}: no src/ — skipped")
            continue
        if not tests:
            print(f"  {name}: R1 FAIL — no tests/ directory")
            findings.append(f"{name}: no compatibility tests")
            continue

        blob = "\n".join(open(f, encoding="utf8", errors="replace").read() for f in tests)

        # R3 — escaped-quote corruption written to disk as-is.
        # A plain `'\\"\` substring test is wrong: `"contains(\\"typeVersion\\":2")"` is valid Rust.
        # The defect this rule exists for (ISSUE-014) was a file written with the escapes left
        # *inside a raw string* — `r#"{ \\"a\\": 1 }"#` — where they are not escapes at all and
        # become part of the JSON. So only flag escapes that appear inside `r"..."` / `r#"..."#`.
        for path, corrupted_line in escaped_quotes_in_raw_strings(tests):
            findings.append(f"{name}: R3 escaped quotes inside a raw string at {path}:{corrupted_line}")

        # R4 — silent skip
        if re.search(r"if\s+!\s*\w+\.exists\(\)\s*\{\s*return", blob):
            findings.append(f"{name}: R4 test returns early when a fixture is missing")

        # R1 — a test actually reads the golden fixtures
        reads_reference = "tests/reference" in blob or "tests\", \"reference" in blob \
            or re.search(r'join\("reference"\)', blob) is not None
        if not reads_reference:
            print(f"  {name}: R1 FAIL — no test reads tests/reference/**")
            findings.append(f"{name}: no test consumes the golden fixtures")
            continue

        # R2 — path resolution independent of CWD
        if "CARGO_MANIFEST_DIR" not in blob:
            findings.append(f"{name}: R2 fixture path does not use CARGO_MANIFEST_DIR")

        exercises_negative = any(neg in blob for neg in negatives) if negatives else False
        print(f"  {name}: R1 ok · R2 {'ok' if 'CARGO_MANIFEST_DIR' in blob else 'FAIL'}"
              f" · negative fixture {'yes' if exercises_negative else 'no'}")
        usable += 1

    print()
    if negatives:
        covered = any(
            any(neg in open(f, encoding="utf8", errors="replace").read()
                for neg in negatives)
            for crate in crates for f in rust_files(crate)
        )
        print(f"-- Negative fixtures on disk: {', '.join(negatives)}")
        if not covered:
            findings.append(f"R5 no crate exercises a negative fixture ({', '.join(negatives)})")
        else:
            print("   R5 PASS — at least one crate reads a negative fixture")
    else:
        print("-- No `-invalid` fixture under tests/reference — R5 cannot be evaluated")
        findings.append("R5 no negative fixture exists under tests/reference")

    total = len([c for c in crates if os.path.isdir(os.path.join(c, "src"))])
    print(f"\nRESULT: {usable}/{total} crates with usable compatibility tests")
    if findings:
        for f in findings:
            print(f"  [FAIL] {f}")
        print("RUST CONFORMANCE AUDIT: FAIL")
        return 1
    print("RUST CONFORMANCE AUDIT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(audit())
