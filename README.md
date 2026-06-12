# AgriHub Fertigation System

Sistem fertigasi sprinkler otomatis berbasis **ET0 + fuzzy logic**, di-deploy di VPS Ubuntu.
Mengambil data sensor dari **agrihub.id** → hitung ET0 (Penman-Monteith) + fuzzy → durasi
penyiraman → kontrol Sonoff via **eWeLink** → diawasi **watchdog** + notifikasi **Telegram**.

## Arsitektur

| Komponen | Stack | Tugas |
|---|---|---|
| **Control App** | Next.js (port 4500) | UI setting + REST API kontrol eWeLink + DB SQLite + scheduler internal |
| **Brain** | Python | ambil sensor agrihub → fuzzy → durasi → `POST /api/run` |
| **Watchdog** | Python (cron tiap menit) | jaring pengaman: matikan valve kadaluarsa, safety cutoff, verifikasi, notif |
| **Database** | SQLite (WAL) | config + log + state, lokal di VPS |

Prinsip robustness: durasi **tidak** dipegang `sleep()` dalam request — ditulis sebagai
`expected_off_at` di DB, lalu watchdog (proses terpisah, cron OS) yang mematikan. Kalau Control
App crash di tengah penyiraman, watchdog tetap menjadwalkan mati (selama PM2/systemd menghidupkan
Control App kembali untuk aktuasi relay).

```
control-app/   Next.js (UI + API + scheduler)
brain/         fuzzy_controller.py, brain.py, db.py, notify.py, requirements.txt
watchdog/      watchdog.py
db/            schema.sql
deploy/        nginx.conf, pm2.config.js, fertigation.service, crontab.example
.env           (gitignored) — semua kredensial
```

---

## 1. Prasyarat (VPS Ubuntu)

- **Node.js LTS** (≥ 20) — untuk Control App + `ewelink-api`.
- **Python 3.11+** — `requirements.txt` memakai `scipy>=1.16` yang butuh Python ≥ 3.11.
  (Di Python 3.10, turunkan ke `scipy>=1.13,<1.16`.)
- **Nginx** (reverse proxy, tanpa HTTPS).
- **PM2** atau **systemd** untuk menjaga Control App hidup.

```bash
sudo apt update && sudo apt install -y nginx python3-venv
# Node via nodesource / nvm sesuai preferensi
```

## 2. Clone + install dependency

```bash
git clone <repo> /opt/agrihub-fertigation
cd /opt/agrihub-fertigation

# Control App
cd control-app && npm install && cd ..

# Brain + watchdog (satu venv dipakai keduanya)
python3 -m venv .venv
.venv/bin/pip install -r brain/requirements.txt
```

## 3. Konfigurasi — apa di `.env`, apa di web (DB)?

Salin template lalu isi: `cp .env.example .env`

**Aturan:** rahasia & konfig runtime → `.env`. Hal yang diubah operator sehari-hari → **web
(database)**. Untuk agrihub/telegram, **web adalah sumber utama**; baris di `.env` hanya dipakai
untuk *mengisi awal* tabel settings pada `npm run seed` pertama (tidak menimpa nilai yang sudah ada).

| Konfigurasi | Diisi di | Catatan |
|---|---|---|
| eWeLink email/password/APP_ID/APP_SECRET/region | **`.env` saja** | rahasia; hanya Control App |
| `EWELINK_DRY_RUN` | `.env` | `1`=simulasi aman (default), `0`=relay live |
| `SESSION_SECRET` | `.env` | secret tanda tangan cookie login (string acak panjang) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` | dipakai seed untuk buat user admin pertama |
| `PORT`, `CONTROL_APP_URL`, `TZ`, `PYTHON_BIN`, `DB_PATH` | `.env` | runtime |
| agrihub base_url + 2 device_id (telemetry) + pemetaan channel | **Web → Settings** | device_id telemetry agrihub (≠ eWeLink); `.env` hanya seed awal |
| telegram bot token | **Web → Settings** | aktifkan bot; user lain `/subscribe` ke bot |
| telegram chat_id admin (opsional) | **Web → Settings** | selalu-terima; `.env` hanya seed awal |
| device_id + channel | **Web → Devices** (DB) | seed placeholder; isi dari `/api/device/list` |
| jadwal jam | **Web → Schedules** (DB) | seed 07:00 & 16:00 |
| parameter fuzzy | **Web → Fuzzy** (DB) | seed default |
| pump delay, safety_max | **Web → Settings** (DB) | seed default |

> Ubah `.env` → **restart** Control App. Ubah di web/DB → langsung berlaku.

**`PYTHON_BIN`** wajib menunjuk ke venv: `/opt/agrihub-fertigation/.venv/bin/python`
(dipakai scheduler & tombol Run-now untuk men-spawn brain).

**`EWELINK_DRY_RUN`**: `1` = sistem tidak pernah menyentuh relay fisik (semua ON/OFF hanya
di-log + shadow-state di DB); semua logika lain tetap jalan. `0` = relay Sonoff benar-benar
digerakkan. Dashboard menampilkan badge DRY-RUN/LIVE.

## 4. Migrasi + seed DB

```bash
cd control-app
npm run migrate    # buat tabel (WAL)
npm run seed       # jadwal 07:00 & 16:00, device config, fuzzy default, admin user
cd ..
```

Seed idempotent — aman dijalankan ulang (tidak menimpa data yang sudah ada).

## 5. Build + jalankan Control App

```bash
cd control-app && npm run build && cd ..
```

Pilih **salah satu**:

**PM2:**
```bash
pm2 start deploy/pm2.config.js
pm2 save && pm2 startup
```

**systemd:**
```bash
sudo cp deploy/fertigation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fertigation
```

Cek: buka `http://127.0.0.1:4500` → login pakai `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

## 6. Pasang watchdog di cron

```bash
crontab -e
# tempel (sesuaikan path) — lihat deploy/crontab.example:
* * * * * /opt/agrihub-fertigation/.venv/bin/python /opt/agrihub-fertigation/watchdog/watchdog.py >> /opt/agrihub-fertigation/watchdog/watchdog.log 2>&1
```

## 7. Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/fertigation
# edit server_name → domainmu
sudo ln -s /etc/nginx/sites-available/fertigation /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 8. Notifikasi Telegram (subscribe model)

Bot memakai **polling `getUpdates`** (bukan webhook, karena deploy HTTP-only). Poller jalan di
dalam Control App dan idle sampai bot token diisi.

1. Buat bot via **@BotFather**, salin token.
2. Isi **Bot token** di halaman **Settings** → Simpan. Bot langsung aktif (tanpa restart).
3. Tiap orang yang mau menerima notif: buka bot di Telegram, kirim **`/subscribe`** (atau `/start`).
   Mereka akan muncul di daftar **Subscriber** di halaman Settings.
4. `/unsubscribe` untuk berhenti, `/status` untuk cek.
5. Semua notif (start / selesai / skip / anomali) **di-broadcast ke semua subscriber aktif**.

> **Chat ID admin (opsional):** kalau diisi, chat itu selalu menerima notif tanpa perlu
> `/subscribe`. Kosongkan kalau cukup pakai subscribe.
>
> Tabel `subscribers` ikut dibuat oleh `npm run migrate` (jalankan ulang bila upgrade dari versi
> tanpa fitur ini — idempotent).

---

## 9. Uji end-to-end

Lakukan dengan `EWELINK_DRY_RUN=1` lebih dulu (tanpa relay fisik):

```bash
# (a) fuzzy jalan
.venv/bin/python brain/fuzzy_controller.py            # tabel sample keluar

# (b) brain decide (perlu agrihub + device_id/channel diatur di Settings)
.venv/bin/python brain/brain.py manual --dry   # --dry: cetak durasi, tak POST/DB/notif

# (c) orkestrasi ON (DRY): valve→7s→pompa, tulis expected_off_at
curl -s -X POST http://127.0.0.1:4500/api/run \
  -H "Content-Type: application/json" \
  -d '{"duration_minutes":2,"triggered_by":"manual"}'

# (d) watchdog mematikan run kadaluarsa
.venv/bin/python watchdog/watchdog.py

# (e) UI: login → Run-now, edit jadwal/fuzzy/settings, lihat Logs
```

Setelah yakin, isi kredensial eWeLink di `.env`, set `EWELINK_DRY_RUN=0`, **restart** Control App,
lalu uji `GET /api/device/list` (read-only) → Run-now → cek valve/pompa → cek watchdog mematikan
→ cek notif Telegram.

## 10. Keamanan

- **Ganti password eWeLink** sebelum produksi (kredensial sempat tertulis di kode lama/chat).
- Semua rahasia hanya di `.env` (gitignored). Tidak ada pola fallback `process.env.X || "rahasia"`.
- UI dilindungi login (cookie + middleware). API kontrol (`/api/device/*`, `/api/run`,
  `/api/stop`) **sengaja terbuka** di localhost agar brain/watchdog bisa memanggil — pastikan
  Nginx hanya meneruskan yang perlu dan port 4500 tidak diekspos langsung ke publik.
- `SESSION_SECRET` pakai string acak panjang yang unik per deployment.

## Integrasi data agrihub

agrihub menyediakan 1 endpoint `GET /api/data/latest?device_id=<id>` yang mengembalikan channel
mentah `{s0, s1, …}` per device (lihat [docs/agrihub-latest-api.md](docs/agrihub-latest-api.md)
untuk kode route handler-nya). brain memanggilnya untuk device weather & soil, lalu memetakan
channel → temp/rh/wind/radiation + rata-rata soil sesuai pilihan di **Settings** (`read_sensors()`
di `brain/brain.py`).

> `device_id` agrihub (telemetry) **berbeda** dari `device_id` eWeLink/Sonoff (kontrol relay).
