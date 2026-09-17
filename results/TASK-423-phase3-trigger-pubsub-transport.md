# TASK-423 — Trigger distributed pub/sub transport

Status: **SUBMITTED_FOR_REVIEW**

Added a dependency-free, port-driven reconstruction of the scaling command publisher, subscriber,
event bus, and registry, plus the multi-main active-workflow command router. Fourteen focused tests
cover prefixed envelopes, immediate/self-send metadata, regular-mode no-op, malformed/sender/target
filtering, debounce, dynamic role changes, registry cleanup, leader activation success and failure,
deactivation ordering, cleanup resilience, and command-handler permissions.

Evidence: trigger suite **33/33 PASS**, trigger gate **5/5 PASS**, scheduler consumer regression and
gate **6/6 PASS**, reference tree unchanged, and `npm run verify:all` exit 0.
