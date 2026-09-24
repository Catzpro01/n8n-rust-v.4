# P5 Security Plane — Operator Runbook

Scope: a single-host n8n-lego install with file storage (`N8N_LEGO_STORAGE=file`, the default for `n8n-lego start`). Every procedure below is exercised end-to-end by `apps/n8n-lego/test/lego-p5-certification.test.mjs` §8 against a real server process and a real data directory. Nothing here describes behaviour that is not implemented.

**Data directory** — `N8N_LEGO_USER_FOLDER` (default `~/.n8n-lego`):

| file | holds | secret? |
|---|---|---|
| `users.json` | accounts: scrypt password hashes, sealed TOTP secrets, SHA-256 API-key digests | no plaintext secrets, but treat as sensitive |
| `credentials.json` | credential metadata + AES-256-GCM envelopes | no plaintext secrets |
| `.credential-keys.json` | the **keyring** (0600): raw key material for the current (and, during a rotation, previous) credential key | **YES — the only file that can decrypt credentials** |
| `.instance.json` | instance identity and secret (session signing) | **YES** |

---

## 1. Golden rules

1. **Stop the server before any mutating credential operation.** `rotate`, `recover` and `restore` refuse while the configured address:port is bound. A running server keeps the store and keyring in memory; it would overwrite your change on its next write and could re-seal records under a key you just retired.
2. **The keyring is backed up separately from the data.** A credential backup is sealed with the current key; without the keyring it is unreadable by design. Store keyring copies somewhere else (offline media / a secrets manager), never next to the backups.
3. **Every finished rotation destroys the previous key's material (crypto-shredding).** Credential backups taken before a rotation can no longer be restored after it. **Take a new backup immediately after every rotation.** (Proven: certification §8 "a finished rotation crypto-shreds the old key".)
4. **Nothing ever mints a replacement key over sealed data.** If the keyring is missing, the server keeps serving metadata and answers `503` on every secret operation; the CLI refuses. The only fix is restoring the keyring file.

## 2. Commands

All commands read the same environment as `n8n-lego start` (`N8N_LEGO_USER_FOLDER`, `N8N_LEGO_PORT`, `N8N_LEGO_HOST`, …). Output is one JSON object per line: identifiers, key references, fingerprints and counts — never key material or secrets. Lines with an `audit` field are the vault's audit events.

| command | server must be stopped | exit codes |
|---|---|---|
| `n8n-lego credentials status` | no | 0 ok · 1 keyring missing while sealed records exist |
| `n8n-lego credentials verify` | no | 0 every record opens · 1 some do not (listed by id + reason) |
| `n8n-lego credentials rotate [--batch N] [--max-batches M]` | **yes** | 0 finished or paused · 2 refused |
| `n8n-lego credentials recover` | **yes** | 0 · 2 refused |
| `n8n-lego credentials backup <file>` | no | 0 · 2 target exists / no keyring |
| `n8n-lego credentials restore-check <file>` | no | 0 valid · 1 rejected (reason printed) |
| `n8n-lego credentials restore <file> [--merge]` | **yes** | 0 · 1 rejected · 2 refused |

Exit code 2 always means *refused, nothing changed*.

## 3. Routine: health check

```sh
n8n-lego credentials status   # rotationPending must be false; legacyPlaintext must be 0
n8n-lego credentials verify   # readable must equal total
```

## 4. Routine: take a credential backup

```sh
n8n-lego credentials backup /secure/backups/creds-$(date +%F).json
n8n-lego credentials restore-check /secure/backups/creds-$(date +%F).json   # the restore drill; writes nothing
cp ~/.n8n-lego/.credential-keys.json /offline/keyring-$(date +%F).json       # separately, see rule 2
```

The backup is written 0600, atomically, and never over an existing file. It contains only already-sealed records inside a second, backup-purpose envelope; `restore-check` validates the manifest, every record digest, tenant binding, duplicate ids, and trial-opens every record.

## 5. Routine: rotate the credential key

```sh
systemctl stop n8n-lego            # or however you run it
n8n-lego credentials backup /secure/backups/pre-rotation.json      # optional, see note
n8n-lego credentials rotate
n8n-lego credentials backup /secure/backups/post-rotation.json     # REQUIRED (rule 3)
cp ~/.n8n-lego/.credential-keys.json /offline/keyring-post-rotation.json
systemctl start n8n-lego
```

Rotation re-encrypts records (credentials **and** users' sealed TOTP secrets) in bounded batches, verifies every record opens under the new key, and only then retires the old key. Note: `pre-rotation.json` stays restorable only together with a keyring copy taken **before** the rotation — keeping such a copy means the old key still exists, which defeats the purpose of rotating after a suspected key exposure.

**Large installs / maintenance windows:** `rotate --batch 64 --max-batches 10` stops after 10 batches and prints `rotation: paused`. The install is fully usable in that state (current + previous key form a bounded read window). Finish later with `n8n-lego credentials recover`, or simply start the server — boot always resumes an interrupted rotation (audit event `credential.rotation-recovered`).

## 6. Incident: the process died during a rotation

Nothing to do by hand. Re-encryption is idempotent and resumable; on the next `n8n-lego start` the vault finishes the rotation before serving. To do it offline instead: `n8n-lego credentials recover`, then `verify`. (Proven: certification §8 "interrupted rotation".)

## 7. Incident: credentials lost or corrupted — restore

```sh
systemctl stop n8n-lego
n8n-lego credentials restore-check /secure/backups/post-rotation.json   # must print valid:true
n8n-lego credentials restore /secure/backups/post-rotation.json         # replace mode (default)
n8n-lego credentials verify
systemctl start n8n-lego
```

`restore` re-runs the full quarantine validation and commits in one atomic write — either every record lands or none. `--merge` keeps records that are not in the backup (backup wins on id conflict). A tampered, truncated, cross-tenant, or wrong-key backup is rejected and nothing is written.

`restore-check` reasons: `backup-key-unavailable` (sealed with a key that is no longer in the keyring — see rule 3), `digest-mismatch`, `partial-backup`, `cross-tenant`, `duplicate-record`, `plaintext-in-backup`, `not-a-backup`, `unsupported-backup-version`, or an authentication failure of the envelope (tamper).

## 8. Incident: the keyring file is missing or unreadable

Symptoms: server log `credential vault unavailable — secret operations will fail closed`; the editor loads and lists credentials, but saving/using a credential answers `503`; `n8n-lego credentials status` exits 1 with `KEYRING MISSING while sealed records exist`.

Fix: stop the server, copy the most recent keyring backup back to `<data dir>/.credential-keys.json` with mode 0600, run `n8n-lego credentials verify`, start the server. There is no other fix: without the key the sealed records are unrecoverable by design, and nothing will mint a new key over them.

## 9. Incident: suspected session or password compromise

* The user changes their password (`Settings → Personal`): every other session of that user is invalidated immediately, and outstanding password-reset links for them are revoked.
* Logging out revokes that session server-side; a copied cookie stops working.
* Enabling MFA (TOTP) requires step-up; disabling it requires a code or a recovery code.
* Login is throttled per account (5 / minute) and per IP (1000 / 5 minutes); throttled attempts answer `429 Too many requests`.

## 10. Incident: an API key leaked

Delete it in `Settings → n8n API` (`DELETE /rest/api-keys/:id`); it is refused from the very next request. Keys are stored only as a SHA-256 digest plus a 4-character hint — a leaked `users.json` does not leak usable keys. A key's effective scopes are always intersected with its owner's **current** role, so demoting the owner shrinks the key immediately. Note: this build exposes no `/api/v1` public-API endpoints yet, so a key cannot currently be exercised over HTTP at all; `/rest` never accepts an API key in place of a session.

## 11. Password reset e-mail

Without a mail transport configured, `POST /rest/forgot-password` answers upstream n8n's `500 Email sending must be set up in order to request a password reset email` for every address, before any lookup (no account enumeration). There is currently no mail transport in this build, and user management (admin-initiated reset) is not implemented either, so **there is no supported way to recover a forgotten password** yet. This is recorded debt (P5.6), not an omission of this runbook. A signed-in user can still change their own password.

## 12. What this runbook does NOT cover (not implemented — do not improvise)

* Multi-host / shared keyring (the keyring is one local file; a second worker host cannot read it — declared scale-out exception, resolve in P11).
* External KMS / HSM key providers.
* Full data-directory backup tooling: back up the whole data directory with your normal filesystem backup **while the server is stopped**, and the keyring separately (rule 2).
* Tenant provisioning (every record is in tenant `default`).

## 13. Rolling back the P5 security plane

Each slice is a merge commit on `main` and reverts independently, newest first: P5.8 `git revert -m 1 <P5.8 merge>`, P5.7 `git revert -m 1 5310bf31`, P5.6 `git revert -m 1 4e6802c8`, P5.5 `git revert -m 1 260b838d`, P5.4 `git revert -m 1 ae99e980`, P5.3 `git revert -m 1 57606b52`, P5.2 `git revert -m 1 d8f18174`, P5.1 `git revert -m 1 0842a05f`.

**Warning — reverting P5.5 or earlier on an install that already sealed credentials:** pre-P5.5 builds cannot read sealed records (there is no plaintext fallback by design). Before downgrading such an install, the credentials must be re-entered after the downgrade, or the install must be restored from a pre-P5.5 data-directory backup. Reverting P5.6/P5.7/P5.8 alone leaves sealed data readable.
