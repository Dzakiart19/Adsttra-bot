# Veneno Traffic Bot v2 — Replit Project

## Tentang Project

Enterprise-grade stealth traffic generation framework. Mensimulasikan kunjungan web yang terlihat organik ke URL target, dengan kemampuan melewati sistem deteksi bot modern.

**Tech stack**: TypeScript · Node.js 20 · Puppeteer + stealth plugin · BullMQ · Redis · Winston · Zod

---

## Yang Sebenarnya Dilakukan Bot Saat Buka URL Target

Bot **bukan sekadar buka lalu pergi**. Urutan persis tiap sesi (15–20 detik, lalu langsung ulang):

1. **Launch Chromium** dengan 30+ hardening flags + injeksi fingerprint JS (Canvas noise, WebGL palsu, navigator konsisten)
2. **Set HTTP Referer** ke salah satu: Facebook, Instagram, X/Twitter, TikTok, YouTube, Pinterest, LinkedIn, Reddit, HackerNews, Quora, WhatsApp Web, Telegram — dipilih acak
3. **Buka URL target** — tunggu `networkidle2` (semua asset loaded)
4. **Aktif selama 20–30 detik** — loop `BehaviorService`:
   - Scroll halus (5 langkah, 100–400px)
   - Mouse move acak dalam viewport
   - Reading pause 2–5 detik dengan micro-jitter ±5px
5. **Contextual click** — scoring semua link, klik yang bernilai tinggi (About/Product/Blog) secara weighted-random
6. **Close browser** → langsung mulai sesi berikutnya (tanpa cooldown)

Dari sisi Google Analytics target: kunjungan dari Reddit, scroll, baca, klik ke halaman product → organik.

---

## Cara Menjalankan

Workflow sudah dikonfigurasi: **`Veneno Traffic Bot`**

Atau manual via Shell:
```bash
npm run dev        # jalankan langsung dengan ts-node
npm run build      # compile TypeScript → dist/
npm start          # jalankan dari dist/
```

---

## Konfigurasi Aktif (Secrets)

| Variable | Nilai Aktif | Keterangan |
|---|---|---|
| `DEFAULT_URL` | URL target | Wajib diisi |
| `MAX_SESSIONS` | `1` | 1 sesi per putaran |
| `SESSION_TIME` | `random` | 30–45 **detik** acak per sesi |
| `MAX_SESSIONS` | `5` | 5 sesi browser paralel per putaran |
| `LOOP_FOREVER` | `true` | Loop terus-menerus tanpa henti |
| `LOOP_COOLDOWN_SEC` | `0` | Tanpa cooldown antar putaran |
| `USE_FREE_PROXIES` | `true` | Auto-scrape + cache proxy gratis |
| `HUMAN_BEHAVIOR` | `true` | Simulasi scroll/mouse/baca aktif |
| `BEHAVIOR_INTENSITY` | `medium` | Frekuensi interaksi sedang |
| `HEADLESS` | `true` | Browser tanpa UI |
| `ORGANIC_SEARCH` | `false` | Navigasi langsung (bukan via SERP) |

Lihat `README.md` untuk tabel lengkap semua variabel.

---

## Deployment

**Target**: Autoscale (free tier)
- **Build**: `npm run build && npx puppeteer browsers install chrome-headless-shell`
- **Run**: `bash start.sh`
- **Health endpoint**: `GET /health` → JSON status

> `start.sh` bertugas set `LD_LIBRARY_PATH` yang dibutuhkan Chromium sebelum menjalankan `node dist/main.js`. Jangan ganti run command langsung ke `node dist/main.js` — Chromium tidak akan bisa load library-nya.

### Cronjob Anti-Sleep
Karena autoscale tidur jika tidak ada request, ping `/health` setiap 1 menit:
```
https://<nama-repl>.replit.app/health
```
Gunakan layanan gratis seperti [cron-job.org](https://cron-job.org).

---

## Live Dashboard

Buka URL preview Replit → port 3000:
- `/` — Dashboard real-time (SSE)
- `/health` — JSON status (untuk cronjob/uptime monitor)
- `/events` — SSE stream langsung

---

## Struktur Project

```
src/
├── main.ts                              # Entry point
├── application/traffic/TrafficOrchestrator.ts   # Inti logika sesi
├── domain/entities/Session.ts
├── domain/interfaces/BrowserEngine.ts
└── infrastructure/
    ├── browser/          # Puppeteer engine, fingerprint, behavior, UA, referrer
    ├── proxy/            # Scrape, validasi streaming, cache proxy (proxy_cache.json)
    ├── queue/            # BullMQ/Redis wrapper + fallback lokal
    ├── monitoring/       # Dashboard HTTP, SSE, metrics, state, reputation
    ├── logging/          # Winston + DashboardTransport
    └── config/config.ts  # Validasi env vars (Zod)
```

---

## Catatan Penting untuk Development

- **Build wajib** sebelum `npm start` — workflow handle otomatis
- **Chromium** harus didownload sekali via `npx puppeteer browsers install chrome-headless-shell` — binary ada di `.puppeteer_cache/` dalam folder project (bukan `~/.cache/`)
- **`start.sh`** wajib digunakan sebagai run command (bukan `node dist/main.js` langsung) — berisi `LD_LIBRARY_PATH` yang benar untuk Chromium di Replit, set `PUPPETEER_CACHE_DIR`, dan auto-download Chrome jika belum ada
- **Redis opsional** — tanpa Redis, bot fallback ke sequential lokal (mode `both`)
- **`proxy_cache.json`** jangan di-commit (sudah ada di `.gitignore`) — TTL 6 jam
- **Proxy pool** dibagi dua tier: `tier1[]` (US/GB/DE/NL/FR/FI/JP/KR) dan `other[]` — `next()` ambil 70% dari Tier 1
- **Proxy validation** dua jalur: country-tagged source → fast validator (`gstatic.com/generate_204`); general source → full ip-api.com (extract countryCode dari body)
- **Background refresh** setiap 2 jam — fetch ulang 19 sumber, tambah proxy baru ke pool tanpa restart
- **`proxyPoolSize`** di dashboard di-update tiap awal putaran (bukan hanya saat startup)
- **`⚠ burnt`** di dashboard = warning informatif, bukan error — bot tetap retry otomatis
- **`ip-api.com`** free tier limit 45 req/menit — dipakai untuk geolocation + reputation check (general proxy validation)
- **`SESSION_TIME`** dalam **detik** (bukan menit). `random` = 15–20 detik
- **Sesi < 60 detik** otomatis pakai 1 step (bukan 4) agar timer dashboard menampilkan durasi penuh
- **`HEADLESS=false`** tidak menampilkan UI browser di Replit (server tanpa display)

---

## User Preferences

- Komunikasi dalam Bahasa Indonesia
- Project berjalan di Replit (bukan Docker/bare-metal lokal)
- Proxy cache diutamakan — hindari re-validasi setiap restart
- Jaga arsitektur Clean Architecture yang sudah ada (Domain / Application / Infrastructure)
- `SESSION_TIME` dalam satuan **detik** (`random` = 20–30 detik)
- Tidak ada cooldown antar putaran (`LOOP_COOLDOWN_SEC=0`)
