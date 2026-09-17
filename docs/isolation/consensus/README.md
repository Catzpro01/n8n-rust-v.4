# Consensus review records — repo-local mirror of `task_consensus_votes`

`STANDING-WORKER-PROTOCOL.md` §3 makes a **dual-phase** review check mandatory (before taking a task, and again after
submitting one) against the `task_consensus_votes` queue. The Supabase instance named in `.env.example` is unreachable
from every worker sandbox in this project (`curl … /rest/v1/task_consensus_votes` → `http=000`, 43 ms, no TLS session —
recorded with the timestamp inside each sweep file below), so the queue has no live transport here.

These files are the durable substitute: one record per reviewed task (or per grouped batch, the convention already used
by `agents 1/3/4` on their own branches), each containing **exactly one vote per (`task_id`, `agent-6`)** and the three
written rubric points `R-1` paths · `R-2` golden-oracle integrity · `R-3` real evidence, plus the command output that
the vote is based on. Votes recorded here are *recommendation-grade*: the DB row cannot be written from this sandbox, so
the owning agent or the orchestrator must mirror them (or re-vote) once `task_consensus_votes` is reachable.

Identity rules honoured in every file: the author of a task is never its reviewer here (`ANTI SELF-APPROVAL`), and a
task is never voted twice by the same agent (`ANTI DOUBLE-VOTE`, composite key `task_id + agent_id`).
