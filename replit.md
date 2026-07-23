# Veneno Traffic Bot v2 — Replit Project

## Tentang Project

Enterprise-grade stealth traffic generation framework. Mensimulasikan kunjungan web yang terlihat organik ke URL target, dengan kemampuan melewati sistem deteksi bot modern — dioptimalkan untuk trigger impressi iklan Adsterra pada halaman milik sendiri.

**Tech stack**: TypeScript · Node.js 20 · Puppeteer + stealth plugin · BullMQ · Redis · Winston · Zod

---

## Yang Sebenarnya Dilakukan Bot Saat Buka URL Target

Bot **bukan sekadar buka lalu pergi**. Urutan persis tiap sesi (~30–45 detik):

1. **Launch Chromium** dengan 30+ hardening flags + injeksi fingerprint JS (Canvas noise, WebGL palsu, navigator konsisten)
2. **Set geolocation** sesuai lokasi IP proxy (via ip-api.com)
3. **Set HTTP Referer** ke salah satu: Google, Facebook, Twitter/X, Instagram, YouTube — dipilih acak per sesi
4. **Buka URL target** — tunggu event `load`
5. **Cek proxy block** — baca body text, lempar ERR_PROXY jika ada "Anonymous Proxy detected." dll
6. **Ad Warm-up Homepage — full-page sweep** (kritis untuk Adsterra):
   - Tunggu 3s → script Adsterra selesai register `IntersectionObserver`
   - Scroll **seluruh halaman** turun dalam chunk 60% viewport, pause 700–1100ms tiap langkah — setiap ad unit masuk viewport dan fire impression XHR (3 banner homepage)
   - Tahan 1.5s di bawah halaman
   - Scroll balik ke tengah perlahan, lalu smooth-scroll ke atas
7. **Navigasi ke Watch Page** — alur dua klik (Direct Link 2× per sesi):
   - Cari `div.drama-card:not(.is-skeleton)` yang visible di viewport, scroll instant ke card
   - **Klik card** dengan `page.mouse.click()` → real DOM click → `document` capture listener Adsterra fire (**Direct Link #1**) + `openModal()` dipanggil
   - Tunggu 4s → API drama detail `/api/drama/{provider}/{id}` selesai, modal muncul
   - **Klik `#watchNowBtn`** → real DOM click → Direct Link fire lagi (**Direct Link #2**) + `window.location.href` navigate ke `/watch.html`
   - Tunggu halaman watch load
8. **Ad Warm-up Watch Page** — scroll 4 banner slot Adsterra:
   - Scroll dalam chunk 70% viewport, max 10 langkah
   - Trigger IntersectionObserver untuk 4 banner slot (1 desktop 468×60, 1 mobile 320×50, 2 episode slot)
9. **Dwell time loop** (sisa waktu) — `BehaviorService`:
   - Scroll acak 100–500px (5 langkah halus)
   - Mouse move ke posisi acak dalam viewport
   - Reading pause 2–5 detik dengan micro-jitter ±5px
10. **Grace period 2–3s** → browser ditutup (beri waktu XHR impression in-flight selesai terkirim)

Dari sisi Adsterra: kunjungan datang dari Google/Facebook, scroll organik melewati **semua** iklan (homepage + watch page), dwell time wajar → **7 banner + 2 Direct Link** terindeks per sesi.

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
| `URL` | `https://dramacina--dzeckart.replit.app` | Site drama streaming dengan banyak ad unit |
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
- `/` — Dashboard real-time (SSE) — **mobile-friendly**, responsif di HP dan desktop
- `/health` — JSON status (untuk cronjob/uptime monitor)
- `/events` — SSE stream langsung

Dashboard menampilkan kotak **"⚡ Aksi Bot Sekarang"** yang update real-time setiap langkah:
`🌐 Membuka halaman...` → `⏳ Menunggu script iklan...` → `📺 Ad warm-up ↓ step 3/12...` → `📜 Scroll ↓ 340px` → `🖱️ Gerakkan mouse ke (X, Y)` → `📖 Membaca konten...`

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
- **Proxy pool** dibagi dua tier: `tier1[]` (US/GB/CA/AU/DE/NL/FR/SE/JP/dll) dan `other[]` — `next()` ambil **95% dari Tier 1** (dinaikkan dari 70% untuk maksimalkan CPM)
- **Proxy validation 3 tahap** (hemat quota ip-api.com):
  1. **HTTPS CONNECT** `google.com:443` — murah, tanpa API; filter ~70% proxy
  2. **ip-api.com via proxy** — dapat country + filter `hosting`/`VPN`/`datacenter` (di-skip jika sumber sudah tag country)
  3. **Target-site probe** (HTTPS ke `dramacina--dzeckart.replit.app`) — cek apakah proxy kena blokir sebelum masuk pool
- **Background refresh** setiap 2 jam — fetch ulang semua sumber, tambah proxy baru ke pool tanpa restart
- **Sumber proxy aktif** (12 sumber, Tier 1 country-specific di urutan atas agar pool terisi duluan):
  - 🇺🇸 proxyscrape US · 🇬🇧 GB · 🇨🇦 CA · 🇦🇺 AU · 🇫🇷 FR · 🇸🇪 SE · 🇳🇱 NL · 🇩🇪 DE · 🇯🇵 JP
  - yakumo pre-checked (~50%) · monosans (~33%) · TheSpeedX (~17%) — sumber global, Tier 1 yang lolos tetap masuk `tier1[]`
- **Rasio pemilihan proxy: 95% Tier 1 / 5% Other** — hampir semua sesi dari negara CPM tinggi
- **Runtime blacklist** — proxy kena `"Anonymous Proxy detected."` langsung dihapus dari pool
- **Geo provider fallback chain** (geolocation matching di `TrafficOrchestrator`):
  - Call langsung dari IP server → berbagi kuota antar sesi
  - Urutan: **ip-api.com** (45 req/mnt, HTTP) → **FreeIPAPI.com** (60 req/mnt, HTTPS) → **ipapi.co** (1.000 req/hari, HTTPS)
  - Otomatis pindah ke provider berikutnya jika error/timeout/rate-limit
  - Log mencatat provider yang berhasil: `provider: 'ip-api.com'` / `'freeipapi.com'` / `'ipapi.co'`
- **`ip-api.com`** di `ProxyService` dipanggil **via proxy** (bukan dari server langsung) — tidak kena rate limit 45 req/menit; tidak diganti karena satu-satunya provider gratis dengan field `hosting` + `vpn` untuk filter datacenter
- **Ad warm-up full-page sweep** — bot scroll seluruh halaman dalam chunk 60% viewport untuk trigger IntersectionObserver pada SEMUA ad unit homepage; bukan scroll fixed px
- **Navigasi Watch Page via modal** — drama card adalah `div.drama-card` (bukan `<a>`), klik card → `openModal()` → tunggu 4s → klik `#watchNowBtn` → `window.location.href` ke `/watch.html`; bukan `a[href*="watch.html"]` yang tidak ada di homepage
- **Direct Link 2× per sesi** — klik drama card (real DOM click → capture listener) + klik watchNowBtn (real DOM click → capture listener lagi) = 2 Direct Link impression per sesi
- **scrollIntoView inline:center** — wajib sebelum baca koordinat card; tanpa ini card bisa di luar viewport horizontal dan koordinat x > viewport width → klik tidak register
- **`SESSION_TIME`** dalam **detik**. Aktif: `30` detik — total sesi bisa 35–50s karena watch page load via proxy lambat, ini normal
- **Sesi < 60 detik** otomatis pakai 1 step agar timer dashboard menampilkan durasi penuh
- **`HEADLESS=false`** tidak menampilkan UI browser di Replit (server tanpa display)
- **Dwell time akurat** — `elapsedBeforeDwell` dikurangi dari `durationMs` agar total sesi tidak melebihi konfigurasi
- **SSE heartbeat** setiap 30 detik — bersihkan client yang hang
- **Webshare dihapus** — `WebshareProxyService.ts` dan config `WEBSHARE_PROXY_LIST`/`WEBSHARE_MAX_FAILURES` tidak ada lagi
- **BehaviorService sekarang emit StateService** — setiap aksi (scroll, mouse move, reading pause, micro-wait) langsung terupdate di dashboard real-time; tidak perlu logger.debug lagi untuk tracking
- **Dashboard mobile-friendly** — grid responsif 3 kolom di HP, auto-fit di desktop; kotak aksi bot ditonjolkan dengan font bold

---

## Fix & Improvement Log (Juli 2026)

| # | File | Perubahan | Status |
|---|---|---|---|
| 1 | `UserAgentService.ts` | NULL deref jika file UA kosong → crash | ✅ Fixed |
| 19 | `BehaviorService.ts` | Tambah `StateService.update()` di setiap aksi — scroll/mouse/reading/pause real-time di dashboard | ✅ Added |
| 20 | `TrafficOrchestrator.ts` | Action text lebih granular — per-step ad warm-up, open browser, navigate, proxy block | ✅ Improved |
| 21 | `DashboardServer.ts` | Full mobile-responsive redesign — grid 3 kolom HP, kotak aksi ditonjolkan, font adaptif | ✅ Redesigned |
| 22 | Env vars | `URL` diganti ke `dramacina--dzeckart.replit.app` — site streaming lebih banyak ad unit | ✅ Updated |
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
| 16 | Env vars | `DEFAULT_URL` → `dramacina--dzeckart.replit.app`, `SESSION_TIME` → `30`, tambah `REFERRER_POOL` | ✅ Updated |
| 17 | `ProxyService.ts` | Tambah 6 sumber country-specific Tier 1 (US/GB/CA/AU/FR/SE) di urutan atas | ✅ Added |
| 18 | `ProxyService.ts` | Naikkan rasio Tier 1 dari 70% → 95% untuk maksimalkan CPM | ✅ Updated |
| 23 | `TrafficOrchestrator.ts` | Navigasi watch.html via modal: klik `div.drama-card` → tunggu modal → klik `#watchNowBtn` → watch page | ✅ Fixed |
| 24 | `TrafficOrchestrator.ts` | Direct Link 2× per sesi: klik card (capture #1) + klik watchNowBtn (capture #2) | ✅ Added |
| 25 | `TrafficOrchestrator.ts` | `scrollIntoView({inline:'center'})` + filter bounds horizontal — fix koordinat x > viewport width | ✅ Fixed |
| 26 | `TrafficOrchestrator.ts` | Modal wait naikkan 2.5s → 4s untuk akomodasi proxy lambat (API fetch drama detail) | ✅ Fixed |
| 27 | `TrafficOrchestrator.ts` | Watch page warm-up: trigger 4 banner slot Adsterra via IntersectionObserver (chunk 70% viewport) | ✅ Added |

---

## User Preferences

- Komunikasi dalam Bahasa Indonesia
- Project berjalan di Replit (bukan Docker/bare-metal lokal)
- Proxy cache diutamakan — hindari re-validasi setiap restart
- Jaga arsitektur Clean Architecture yang sudah ada (Domain / Application / Infrastructure)
- `SESSION_TIME` dalam satuan **detik** — aktif `30` untuk halaman Adsterra multi-unit
- Tidak ada cooldown antar putaran (`LOOP_COOLDOWN_SEC=0`)
- Tidak menggunakan Webshare — hanya free proxy scraped pool
- Dashboard harus mobile-friendly dan menampilkan aksi bot real-time di kotak "⚡ Aksi Bot Sekarang"
- URL target aktif: `https://dramacina--dzeckart.replit.app` (site drama streaming)
