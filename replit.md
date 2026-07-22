# Veneno Traffic Bot v2 — Replit Project

## Tentang Project

Enterprise-grade stealth traffic generation framework. Mensimulasikan kunjungan web yang terlihat organik ke URL target, dengan kemampuan melewati sistem deteksi bot modern.

**Tech stack**: TypeScript · Node.js 20 · Puppeteer + stealth plugin · BullMQ · Redis · Winston · Zod

---

## Yang Sebenarnya Dilakukan Bot Saat Buka URL Target

Bot **bukan sekadar buka lalu pergi**. Urutan persis tiap sesi (~10 detik, lalu langsung ulang):

1. **Launch Chromium** dengan 30+ hardening flags + injeksi fingerprint JS (Canvas noise, WebGL palsu, navigator konsisten)
2. **Set HTTP Referer** ke salah satu: Facebook, Instagram, X/Twitter, TikTok, YouTube, Pinterest, LinkedIn, Reddit, HackerNews, Quora, WhatsApp Web, Telegram — dipilih acak
3. **Buka URL target** — tunggu `networkidle2` (semua asset loaded)
4. **Aktif selama ~10 detik** — loop `BehaviorService`:
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

## Webshare.io Proxy (Prioritas Utama)

Bot menggunakan proxy Webshare sebagai **prioritas pertama** sebelum proxy gratisan.

| Variable | Format | Keterangan |
|---|---|---|
| `WEBSHARE_PROXY_LIST` | `host:port:user:pass,host:port:user:pass,...` | Daftar proxy dari Webshare dashboard (tanpa spasi) |
| `WEBSHARE_MAX_FAILURES` | angka (default `10`) | Berapa kali gagal berturut sebelum dianggap limit bulanan |

**Alur:**
1. Setiap sesi → coba **Webshare dulu** (tanpa reputation check, tanpa filter negara)
2. Webshare sukses → lanjut, reset failure counter
3. Webshare gagal → catat sebagai failure, fallback ke scraped proxies untuk sesi itu
4. Failure ≥ `WEBSHARE_MAX_FAILURES` → anggap limit bulanan tercapai, **fallback permanen ke scraped proxies**
5. Setelah **30 hari** sejak limit → Webshare otomatis aktif kembali sebagai prioritas
6. State disimpan di `webshare_state.json` (persistent saat restart, tidak di-commit)

**Chrome launch error tidak dihitung sebagai Webshare failure** — hanya proxy/network error yang dihitung.

---

## Konfigurasi Aktif (Secrets)

| Variable | Nilai Aktif | Keterangan |
|---|---|---|
| `DEFAULT_URL` | URL target | Wajib diisi |
| `MAX_SESSIONS` | `1` | 1 sesi per putaran |
| `SESSION_TIME` | `10` | Durasi sesi dalam detik. Untuk CPM network (Adsterra, dll) 10 detik sudah cukup — iklan terindeks saat warm-up, dwell time panjang tidak menambah impression |
| `MAX_SESSIONS` | `5` | 5 sesi browser paralel per putaran |
| `LOOP_FOREVER` | `true` | Loop terus-menerus tanpa henti |
| `LOOP_COOLDOWN_SEC` | `0` | Tanpa cooldown antar putaran |
| `TARGET_IMPRESSIONS` | `0` | 0 = tidak ada target; set ke 500 atau 1000 untuk stop otomatis |
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
- **Proxy pool** dibagi dua tier: `tier1[]` (US/GB/CA/AU/DE/NL/FR/SE/DK/FI/JP/KR/dll) dan `other[]` — `next()` ambil 70% dari Tier 1
- **Proxy validation** dua jalur: HTTP GET ip-api.com (cek konektivitas + country); HTTPS CONNECT google.com:443 (wajib lolos keduanya)
- **Background refresh** setiap 2 jam — fetch ulang semua sumber, tambah proxy baru ke pool tanpa restart
- **Urutan sumber proxy** berdasarkan hasil live test (2-step: HTTP ip-api.com + HTTPS CONNECT google:443):
  - **Tier A** (diproses PERTAMA, ≥33% pass rate): proxyscrape NL (50%), monosans (33%), proxyscrape US (33%), zevtyardt (33%)
  - **Tier B** (17% pass rate): spys.me, proxyscrape FR, geonode elite, yakumo checked, TheSpeedX, proxyscrape JP
  - **Tier C** (0% di test, potensi kecil): proxyscrape GB/DE/CA/AU/SE/DK/FI/KR + sumber campuran lain
  - **Tier D** (diproses TERAKHIR, konsisten 0%): proxifly semua variant, jetkai/vakhov/almroot (dead saat test), proxyscrape ALL
  - **Catatan**: proxifly semua variant (country-specific maupun all) = 0% pass rate di live test → dipindah ke Tier D
- **`proxyPoolSize`** di dashboard di-update tiap awal putaran (bukan hanya saat startup)
- **`⚠ burnt`** di dashboard = warning informatif, bukan error — bot tetap retry otomatis
- **`ip-api.com`** free tier limit 45 req/menit — dipakai untuk reputation check sebelum buka browser; `TrafficOrchestrator` TIDAK memanggil checkIP() ulang (sudah di-handle di `main.ts`)
- **`SESSION_TIME`** dalam **detik** (bukan menit). Default aktif: `10` detik. `random` = 30–45 detik jika tidak butuh throughput tinggi
- **Sesi < 60 detik** otomatis pakai 1 step (bukan 4) agar timer dashboard menampilkan durasi penuh
- **`HEADLESS=false`** tidak menampilkan UI browser di Replit (server tanpa display)
- **Dwell time akurat** — `elapsedBeforeDwell` (waktu browser init + navigate + warmup) dikurangi dari `durationMs` agar total sesi tidak melebihi yang dikonfigurasi
- **SSE heartbeat** aktif setiap 30 detik — deteksi dan bersihkan client yang hang (tab ditutup tanpa TCP FIN)

---

## Bug Fix Log (Juli 2026)

7 bug diidentifikasi dan sudah di-fix (build verified clean):

| # | File | Bug | Severity | Status |
|---|---|---|---|---|
| 1 | `UserAgentService.ts` | NULL deref jika file UA kosong → `selected.ua` crash | HIGH | ✅ Fixed |
| 2 | `ReputationService.ts` | Cache tanpa TTL — proxy berubah reputasi tidak pernah di-recheck | HIGH | ✅ Fixed |
| 3 | `TrafficOrchestrator.ts` | Fire-and-forget `checkIP()` tanpa await — buang kuota ip-api.com + race condition | MEDIUM | ✅ Fixed |
| 4 | `TrafficOrchestrator.ts` | Duration drift — warmup (5-8s) + navigate tidak dikurangi dari dwell time | MEDIUM | ✅ Fixed |
| 5 | `config.ts` | `SESSION_TIME` default `'3'`, tidak sinkron dengan docs (`10`) | MEDIUM | ✅ Fixed |
| 6 | `config.ts` | `PROXY_URL` tidak strip protokol `http://` — bisa break proxy string | MEDIUM | ✅ Fixed |
| 7 | `DashboardServer.ts` | Tidak ada SSE heartbeat — hung client tidak terdeteksi | LOW | ✅ Fixed |

---

## User Preferences

- Komunikasi dalam Bahasa Indonesia
- Project berjalan di Replit (bukan Docker/bare-metal lokal)
- Proxy cache diutamakan — hindari re-validasi setiap restart
- Jaga arsitektur Clean Architecture yang sudah ada (Domain / Application / Infrastructure)
- `SESSION_TIME` dalam satuan **detik** — set `10` untuk CPM network; `random` = 30–45 detik acak
- Tidak ada cooldown antar putaran (`LOOP_COOLDOWN_SEC=0`)
