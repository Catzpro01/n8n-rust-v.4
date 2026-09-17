# Evidence transcripts

Produced by `npm run verify:engine:evidence` (root). Two modes, both required:

| file | what it proves |
|---|---|
| `POOL-002-R1-live.txt` | the whole suite plus the live-oracle gate, run against the installed n8n 2.9.1 reference |
| `POOL-002-R1-offline.txt` | the same suite with the oracle suppressed (`ENGINE_NO_RUNTIME=1`), i.e. what a machine without `.runtime` actually sees |

`summary.json` carries the counts and the sha256 of the fixtures the transcripts describe;
`test/08-evidence` fails if those hashes drift, so a stale transcript cannot be quoted as
current proof. Nothing here is hand-editable evidence — regenerate, never rewrite.
