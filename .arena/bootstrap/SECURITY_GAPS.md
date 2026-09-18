# RESIDUAL SECURITY GAPS & MITIGATION ROADMAP
**Date:** 2026-09-18  
**Scope:** Arena AI Multi-Agent Environment & VPS Host Security  

---

## 1. Residual Risks & Current Status

| ID | Area | Current Status | Risk Level | Mitigation in Place | Target Final State |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GAP-01** | OS User Isolation | All 5 agents run under OS user `fern` in separate directories (`/srv/arena/workspaces/agent-0X`). | Medium | FilesystemGuard enforces path jails in software and systemd isolates workspaces. | Dedicated Linux system users (`arena-01`..`arena-05`) with POSIX permissions `700`. |
| **GAP-02** | Master GitHub PAT | Repo currently uses a classic personal access token (`ghp_...`). | High | PAT only stored on VPS backend, never provided to Arena agents. | Migrate to short-lived GitHub App Installation Tokens. |
| **GAP-03** | Supabase Secret Storage | `SUPABASE_SERVICE_ROLE_KEY` stored in `/home/fern/arena/.env`. | Medium | Only accessible by `arena-bridge` backend; agents have ZERO direct access. | Rotate to `SUPABASE_SECRET_KEY` and restrict network access. |
| **GAP-04** | Webhook Verification | Port 9000 verifies `X-Hub-Signature-256`. | Low | HMAC-SHA256 implemented in `tools/arena-bridge/server.py`. | Add replay cache and timestamp validation window (±5m). |
| **GAP-05** | Resource Limits (cgroups) | Python timeout (300s/900s) implemented in executor. | Low | Executor enforces subprocess timeout and memory governor. | Add systemd `MemoryMax=400M` and `CPUQuota=40%` per agent slice. |

---

## 2. Actions Requiring Manual Cloud Console Intervention
1. **GitHub App Registration**:
   - Membuka `https://github.com/settings/apps/new` secara manual.
   - Mendaftarkan URL webhook dan menyimpan kunci privat `.pem` ke `/etc/arena/github_app.pem`.
2. **GitHub Branch Protection for `main`**:
   - Membuka settings repo -> Branches -> Add branch protection rule untuk `main`.
   - Mengaktifkan "Require a pull request before merging" dan "Require status checks to pass before merging".
3. **Supabase Secret Key Rotation**:
   - Membuka Supabase dashboard -> Settings -> API -> Rotate Service Role Key jika dicurigai pernah terekspos dalam riwayat lama.
