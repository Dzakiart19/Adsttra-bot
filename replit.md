# Veneno Traffic Bot v2 — Replit Project

## Tentang Project

Enterprise-grade stealth traffic generation framework. Mensimulasikan kunjungan web yang terlihat organik ke URL target, dengan kemampuan melewati sistem deteksi bot modern — dioptimalkan untuk trigger impressi iklan Adsterra pada halaman milik sendiri.

**Tech stack**: TypeScript · Node.js 20 · Puppeteer + stealth plugin · BullMQ · Redis · Winston · Zod

---

## Yang Sebenarnya Dilakukan Bot Saat Buka URL Target

Bot **bukan sekadar buka lalu pergi**. Urutan persis tiap sesi (~30 detik):

1. **Launch Chromium** dengan 30+ hardening flags + injeksi fingerprint JS (Canvas noise, WebGL palsu, navigator konsisten)
2. **Set geolocation** sesuai lokasi IP proxy (via ip-api.com)
3. **Set HTTP Referer** ke salah satu: Google, Facebook, Twitter/X, Instagram, YouTube — dipilih acak per sesi
4. **Buka URL target** — tunggu event `load`
5. **Cek proxy block** — baca body text, lempar ERR_PROXY jika ada "Anonymous Proxy detected." dll
6. **Ad Warm-up — full-page sweep** (kritis untuk Adsterra):
   - Tunggu 3s → script Adsterra selesai register `IntersectionObserver`
   - Scroll **seluruh halaman** turun dalam chunk 60% viewport, pause 700–1100ms tiap langkah — setiap ad unit masuk viewport dan fire impression XHR
   - Tahan 1.5s di bawah halaman
   - Scroll balik ke tengah perlahan, lalu smooth-scroll ke atas
7. **Dwell time loop** (sisa waktu dari 30s) — `BehaviorService`:
   - Scroll acak 100–500px (5 langkah halus)
   - Mouse move ke posisi acak dalam viewport
   - Reading pause 2–5 detik dengan micro-jitter ±5px
8. **Contextual click** — scoring semua `<a>` di halaman, klik link bernilai tinggi (About/Product/Blog) secara weighted-random, hindari login/terms/privacy
9. **Grace period 2–3s** → browser ditutup (beri waktu XHR impression in-flight selesai terkirim)

Dari sisi Adsterra: kunjungan datang dari Google/Facebook, scroll organik melewati semua iklan, dwell time wajar → semua 10 ad unit terindeks.

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

## Konfigurasi Aktif (Env Vars)

| Variable | Nilai Aktif | Keterangan |
|---|---|---|
| `DEFAULT_URL` | `https://simpanin.web.app` | Halaman target dengan 10 Adsterra ad unit |
| `MAX_SESSIONS` | `5` | 5 sesi per putaran (sequential, tanpa Redis) |
| `SESSION_TIME` | `30` | 30 detik per sesi — cukup untuk full-page sweep + dwell + semua iklan terindeks |
| `LOOP_FOREVER` | `true` | Loop terus-menerus tanpa henti |
| `LOOP_COOLDOWN_SEC` | `0` | Tanpa cooldown antar putaran |
| `TARGET_IMPRESSIONS` | `0` | 0 = tidak ada target; set > 0 untuk stop otomatis |
| `USE_FREE_PROXIES` | `true` | Auto-scrape + validasi 3-tahap + cache proxy gratis |
| `REFERRER_POOL` | google,facebook,t.co,instagram,youtube | Referrer organik dipilih acak per sesi |
| `HUMAN_BEHAVIOR` | `true` | Simulasi scroll/mouse/baca aktif |
| `BEHAVIOR_INTENSITY` | `medium` | Frekuensi interaksi sedang |
| `HEADLESS` | `true` | Browser tanpa UI |
| `MATCH_GEOLOCATION` | `true` | Geolocation browser sesuai IP proxy |
| `ORGANIC_SEARCH` | `false` | Navigasi langsung dengan referrer spoof |
| `PROXY_VALIDATE_CONCURRENCY` | `40` | Worker paralel saat validasi proxy |

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
├── main.ts                              # Entry point + orchestration loop
├── application/traffic/TrafficOrchestrator.ts   # Inti logika sesi
├── domain/entities/Session.ts
├── domain/interfaces/BrowserEngine.ts
└── infrastructure/
    ├── browser/          # Puppeteer engine, fingerprint, behavior, UA, referrer
    ├── proxy/            # Scrape, validasi streaming, cache proxy (proxy_cache.json)
    │   └── ProxyService.ts              # (WebshareProxyService dihapus — tidak dipakai)
    ├── queue/            # BullMQ/Redis wrapper + fallback lokal
    ├── monitoring/       # Dashboard HTTP, SSE, metrics, state, uptime
    ├── logging/          # Winston + DashboardTransport
    └── config/config.ts  # Validasi env vars (Zod)
```

---

## Catatan Penting untuk Development

- **Build wajib** sebelum `npm start` — workflow handle otomatis
- **Chromium** didownload sekali via `npx puppeteer browsers install chrome-headless-shell` — binary di `.puppeteer_cache/` (bukan `~/.cache/`)
- **`start.sh`** wajib sebagai run command — set `LD_LIBRARY_PATH` + `PUPPETEER_CACHE_DIR` + auto-download Chrome jika belum ada
- **Redis opsional** — tanpa Redis, fallback otomatis ke sequential lokal (mode `both`)
- **`proxy_cache.json`** jangan di-commit (ada di `.gitignore`) — TTL 6 jam
- **Proxy pool** dibagi dua tier: `tier1[]` (US/GB/CA/AU/DE/NL/FR/SE/JP/dll) dan `other[]` — `next()` ambil 70% dari Tier 1
- **Proxy validation 3 tahap** (hemat quota ip-api.com):
  1. **HTTPS CONNECT** `google.com:443` — murah, tanpa API; filter ~70% proxy
  2. **ip-api.com via proxy** — dapat country + filter `hosting`/`VPN`/`datacenter`
  3. **Target-site probe** (HTTPS ke `simpanin.web.app`) — Firebase tidak block proxy → hampir semua lolos → pool besar
- **Background refresh** setiap 2 jam — fetch ulang semua sumber, tambah proxy baru ke pool tanpa restart
- **Sumber proxy aktif** (6 sumber, live test 2026-07-22):
  - yakumo pre-checked (~50%), monosans (~33%), proxyscrape NL/DE (~33%), proxyscrape JP (~17%), TheSpeedX (~17%)
- **Runtime blacklist** — proxy kena `"Anonymous Proxy detected."` langsung dihapus dari pool
- **`ip-api.com`** dipanggil HANYA via proxy saat validasi — tidak kena rate limit 45 req/menit
- **Ad warm-up full-page sweep** — bot scroll seluruh halaman dalam chunk 60% viewport untuk trigger IntersectionObserver pada SEMUA ad unit; bukan scroll fixed px
- **`SESSION_TIME`** dalam **detik**. Aktif: `30` detik — optimal untuk halaman dengan 10 Adsterra ad unit
- **Sesi < 60 detik** otomatis pakai 1 step agar timer dashboard menampilkan durasi penuh
- **`HEADLESS=false`** tidak menampilkan UI browser di Replit (server tanpa display)
- **Dwell time akurat** — `elapsedBeforeDwell` dikurangi dari `durationMs` agar total sesi tidak melebihi konfigurasi
- **SSE heartbeat** setiap 30 detik — bersihkan client yang hang
- **Webshare dihapus** — `WebshareProxyService.ts` dan config `WEBSHARE_PROXY_LIST`/`WEBSHARE_MAX_FAILURES` tidak ada lagi

---

## Fix & Improvement Log (Juli 2026)

| # | File | Perubahan | Status |
|---|---|---|---|
| 1 | `UserAgentService.ts` | NULL deref jika file UA kosong → crash | ✅ Fixed |
| 2 | `ReputationService.ts` | Cache tanpa TTL — proxy berubah reputasi tidak pernah di-recheck | ✅ Fixed |
| 3 | `TrafficOrchestrator.ts` | Fire-and-forget `checkIP()` tanpa await — race condition | ✅ Fixed |
| 4 | `TrafficOrchestrator.ts` | Duration drift — warmup + navigate tidak dikurangi dari dwell time | ✅ Fixed |
| 5 | `config.ts` | `SESSION_TIME` default `'3'`, tidak sinkron dengan docs | ✅ Fixed |
| 6 | `config.ts` | `PROXY_URL` tidak strip protokol `http://` — bisa break proxy string | ✅ Fixed |
| 7 | `DashboardServer.ts` | Tidak ada SSE heartbeat — hung client tidak terdeteksi | ✅ Fixed |
| 8 | `ProxyService.ts` | Tambah target-site probe (tahap 3) + runtime blacklist | ✅ Added |
| 9 | `ProxyService.ts` | Ubah urutan validasi: HTTPS CONNECT dulu → ip-api.com — hemat ~70% quota | ✅ Optimized |
| 10 | `ProxyService.ts` | ip-api.com request fields `hosting+vpn` → filter datacenter saat validasi | ✅ Optimized |
| 11 | `main.ts` | Hapus `ReputationService.checkIP()` runtime — proxy sudah pre-filtered | ✅ Removed |
| 12 | `main.ts` | Fix scope bug TypeScript: variabel `p` di `runWorker()` keluar scope di catch | ✅ Fixed |
| 13 | `WebshareProxyService.ts` | Hapus seluruh fitur Webshare — tidak digunakan | ✅ Removed |
| 14 | `config.ts` | Hapus `WEBSHARE_PROXY_LIST` + `WEBSHARE_MAX_FAILURES` dari schema | ✅ Removed |
| 15 | `TrafficOrchestrator.ts` | Ad warm-up: ganti scroll fixed 550px → full-page sweep per 60% viewport | ✅ Improved |
| 16 | Env vars | `DEFAULT_URL` → `simpanin.web.app`, `SESSION_TIME` → `30`, tambah `REFERRER_POOL` | ✅ Updated |

---

## User Preferences

- Komunikasi dalam Bahasa Indonesia
- Project berjalan di Replit (bukan Docker/bare-metal lokal)
- Proxy cache diutamakan — hindari re-validasi setiap restart
- Jaga arsitektur Clean Architecture yang sudah ada (Domain / Application / Infrastructure)
- `SESSION_TIME` dalam satuan **detik** — aktif `30` untuk halaman Adsterra multi-unit
- Tidak ada cooldown antar putaran (`LOOP_COOLDOWN_SEC=0`)
- Tidak menggunakan Webshare — hanya free proxy scraped pool
