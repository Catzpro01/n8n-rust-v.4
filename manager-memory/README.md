# arena-manager: Manager memory (DEC-0008)

This branch is the **Manager's durable memory**. It is not a code authority. `main` wins every conflict (rule precedence: main > canonical decisions on main > arena-manager > task/issue > session prompt > conversation).

- **Base.** Each rebuild starts from the current `main` and adds only `manager-memory/`. Product and governance code changes go through PRs to `main`, never through this branch.
- **Previous history.** The branch history up to `28eea831` is preserved in the tag `archive/arena-manager-28eea831`. The per-commit outcome is in [`AUDIT.md`](AUDIT.md).
- **Contents:**
  - `views/*.md`: derived views rendered by `node tools/workforce/src/cli.mjs render`. Do not hand-edit them; regenerate them instead.
  - `state/`: a snapshot of the control-plane operational store (objects, events, idempotency records, counters). A new Manager session rehydrates from it with `--state manager-memory/state`.
  - [`HANDOFF.md`](HANDOFF.md): the session handoff (§8 fields). A new session should start here.
- **Never stored here:**
  - tokens, keys or any credential (DEC-0004, DEC-0009);
  - runtime PIDs or logs;
  - heartbeat noise. The branch is updated only at meaningful events, such as a merge, a decision or a blocker change.

## Rehydrate a new Manager session

```bash
git clone https://github.com/Catzpro01/n8n-rust-v.4 && cd n8n-rust-v.4
git fetch origin arena-manager && git worktree add ../mem origin/arena-manager
node tools/workforce/src/cli.mjs status --state ../mem/manager-memory/state \
  --main "$(git rev-parse origin/main)" --arena-manager "$(git rev-parse origin/arena-manager)"
```

Then verify the live state before acting: remote `main`, open PRs, branches and the credential mechanism. Never continue from SHAs quoted in memory alone.
