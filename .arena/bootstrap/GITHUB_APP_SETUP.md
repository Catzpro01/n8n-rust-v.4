# GITHUB APP SPECIFICATION & WEBHOOK INTEGRATION (LEAST PRIVILEGE)

Dokumen ini adalah spesifikasi resmi pendaftaran GitHub App untuk menggantikan Personal Access Token (PAT) master dengan token instalasi berbatas waktu (*short-lived scoped installation tokens*).

---

## 1. Konfigurasi GitHub App
Daftarkan GitHub App di: `https://github.com/settings/apps/new`
- **GitHub App name**: `n8n-rust-arena-worker`
- **Homepage URL**: `https://github.com/Catzpro01/n8n-rust-v.4`
- **Webhook**:
  - **Active**: Checked
  - **Webhook URL**: `http://157.10.160.95/github/webhook`
  - **Webhook secret**: Simpan nilai acak (32+ karakter) dan simpan di `/home/fern/arena/.env` sebagai `GITHUB_WEBHOOK_SECRET`.

---

## 2. Minimum Permissions (Least Privilege Target)

| Kategori Izin | Tingkat Akses | Justifikasi |
| :--- | :--- | :--- |
| **Repository: Contents** | Read & write | Membaca task manifest dan melakukan checkout/commit/push pada branch `arena/<agent-id>/*`. |
| **Repository: Pull requests** | Read & write | Membuat dan memperbarui PR hasil pekerjaan agen. |
| **Repository: Checks** | Read & write | Melaporkan status gate / smoke test ke GitHub checks UI. |
| **Repository: Metadata** | Read-only | Akses dasar informasi repo & commit sha (wajib). |

### ⛔ Permission yang DILARANG:
- **Administration**: NO ACCESS
- **Secrets**: NO ACCESS
- **Workflows**: NO ACCESS
- **Organization administration**: NO ACCESS

---

## 3. Webhook Events yang Dilanggan (Subscribed Events)
- `Pull request` (Opened, Synchronize, Closed)
- `Push` (Pemberitahuan commit cabang task)
- `Workflow run` (Pemantauan kelulusan CI)

---

## 4. Instalasi dan Penyimpanan Kunci Privat di VPS Host
1. Unduh file `.pem` kunci privat GitHub App dari dashboard GitHub.
2. Simpan di direktori terlindungi VPS (hanya dapat dibaca root/fern):
   ```bash
   sudo mkdir -p /etc/arena
   sudo cp path-to-private-key.pem /etc/arena/github_app.pem
   sudo chmod 600 /etc/arena/github_app.pem
   sudo chown fern:fern /etc/arena/github_app.pem
   ```
3. Catat `GITHUB_APP_ID` dan `GITHUB_APP_INSTALLATION_ID` ke file `/home/fern/arena/.env`.
