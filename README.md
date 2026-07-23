# Veneno Traffic Bot v2

Enterprise-grade stealth traffic generation framework — berjalan di **Replit** (Node.js 20, tanpa Docker).

---

## Apa yang Sebenarnya Dilakukan Bot

Bot **bukan sekadar buka URL lalu pergi**. Ini urutan persis yang terjadi tiap sesi:

### 1. Launch Browser + Inject Fingerprint
Chromium headless diluncurkan dengan 30+ hardening flags. Sebelum halaman pertama dimuat, script JS langsung disuntik ke engine browser:
- `navigator.webdriver = false`
- GPU vendor/renderer palsu (NVIDIA, Intel, Apple M1)
- Canvas noise (pixel terakhir ±1 — tak terdeteksi, tapi fingerprint beda)
- WebRTC leak diblokir
- Semua `navigator.*`, `screen.*`, `window.*` konsisten satu sama lain

### 2. Spoof Referrer HTTP Header
Sebelum buka URL target, bot set `Referer` header ke salah satu dari:
`Reddit`, `HackerNews`, `LinkedIn`, `Quora`, `Twitter/X`, `Facebook` — dipilih acak.

Pool referrer default mencakup: `Facebook`, `Instagram`, `X / Twitter`, `TikTok`, `YouTube`, `Pinterest`, `LinkedIn`, `Reddit`, `HackerNews`, `Quora`, `WhatsApp Web`, `Telegram`.

**Efek**: Di Google Analytics / server log target, kunjungan terlihat *datang dari* platform tersebut. Bukan direct traffic.

### 3. Buka URL Target
`page.goto(url, { waitUntil: 'load' })` — bot tunggu event load selesai lalu lanjut (bukan `networkidle2` karena ad-heavy site terus-menerus ping tracking server sehingga networkidle2 tidak pernah tercapai → timeout 60s).

### 4. Diam di Halaman Selama Durasi Sesi — Sambil Aktif
Selama durasi sesi, `BehaviorService` loop terus-menerus memilih aksi acak:

| Aksi | Probabilitas (medium) | Detail | Dashboard Real-time |
|---|---|---|---|
| **Scroll** | 25% | Atas/bawah, 100–400px, dipecah 5 langkah halus dengan delay antar langkah | `📜 Scroll ↓ 340px` |
| **Mouse Move** | 25% | Gerak ke koordinat X,Y acak dalam viewport | `🖱️ Gerakkan mouse ke (872, 441)` |
| **Reading Pause** | 30% | Diam 2–5 detik + micro-jitter mouse ±5px (simulasi mata membaca) | `📖 Membaca konten halaman... (3.2s)` |
| **Micro-wait** | 20% | Idle singkat 100–600ms | `⏸ Jeda sejenak... (420ms)` |

Setiap aksi update dashboard **real-time** via `StateService` — teks langsung muncul di kotak "⚡ Aksi Bot Sekarang".

### 5. Contextual Click (Di Akhir Sesi)
Bot evaluasi semua link `<a>` di halaman, beri skor, klik satu:

| Kondisi | Skor |
|---|---|
| Teks mengandung: *about, product, service, feature, price, blog, contact* | **+20** |
| Teks mengandung: *login, signup, terms, privacy, policy* | **−5** |
| Ukuran elemen (lebar × tinggi) | **+0–10** |

Link dipilih secara **weighted-random** → `window.location.href = link.href`

**Efek**: Bot tidak hanya hit landing page — ia klik masuk ke halaman product/about/blog, menambah pageview dan dwell time lebih realistis.

### 6. Close Browser

**Dari perspektif Google Analytics target**: ada kunjungan dari Facebook/Instagram/X/TikTok/dll, scroll-scroll, baca beberapa detik, klik ke halaman product, lalu pergi. Terlihat organik.

---

## Quick Start (Replit)

Project ini sudah dikonfigurasi untuk langsung jalan di Replit. Tidak perlu Docker, tidak perlu setup lokal.

1. **Buka Replit** dan fork/clone repl ini.
2. **Atur konfigurasi** di tab **Secrets** (ikon 🔒).
3. **Jalankan** via workflow `Veneno Traffic Bot` yang sudah terkonfigurasi, atau:
   ```bash
   npm run dev
   ```

> Bot langsung berjalan. Tanpa Redis, mode `both` otomatis fallback ke eksekusi sequential lokal.

---

## Manual Setup (Bare-metal Linux)

```bash
# 1. Install system dependencies (Chromium libs)
sudo npm run setup:linux

# 2. Install Node dependencies
npm install

# 3. Download Chromium
npx puppeteer browsers install chrome-headless-shell

# 4. Build TypeScript
npm run build

# 5. Jalankan
bash start.sh
```

> **Catatan**: Gunakan `bash start.sh` bukan `npm start` / `node dist/main.js` langsung. `start.sh` berisi `LD_LIBRARY_PATH` yang diperlukan Chromium untuk berjalan.

---

## Konfigurasi (.env / Secrets)

Salin `.env.example` dan sesuaikan, atau set langsung di tab Secrets Replit.

### Variabel Lengkap

| Variable                     | Default                    | Deskripsi                                                         |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `DEFAULT_URL`                | *(wajib diisi)*            | URL target utama                                                  |
| `MAX_SESSIONS`               | `1`                        | Jumlah sesi browser per putaran                                   |
| `SESSION_TIME`               | `10`                       | Durasi sesi dalam **detik** (integer) atau `random` = 30–45 detik acak. Untuk CPM network, 10 detik cukup — iklan sudah terindeks saat warm-up selesai |
| `LOOP_FOREVER`               | `true`                     | Loop terus-menerus tanpa henti                                    |
| `LOOP_COOLDOWN_SEC`          | `0`                        | Jeda antar putaran (detik). `0` = tanpa cooldown, langsung ulang  |
| `HEADLESS`                   | `true`                     | Jalankan browser tanpa UI                                         |
| `HUMAN_BEHAVIOR`             | `true`                     | Aktifkan simulasi mouse, scroll, dan reading                      |
| `BEHAVIOR_INTENSITY`         | `medium`                   | Frekuensi interaksi: `low`, `medium`, `high`                      |
| `PERSISTENT_SESSIONS`        | `false`                    | Simpan cookies/cache browser lintas-run                           |
| `SESSIONS_DATA_DIR`          | `./sessions`               | Direktori penyimpanan profil sesi persisten                       |
| `BOT_ROLE`                   | `both`                     | Role eksekusi: `producer`, `worker`, atau `both`                  |
| `REDIS_URL`                  | `redis://127.0.0.1:6379`   | URL Redis untuk distributed queue (opsional)                      |
| `USE_FREE_PROXIES`           | `true`                     | Aktifkan auto-scrape + validasi proxy gratis                      |
| `PROXY_VALIDATE_CONCURRENCY` | `40`                       | Jumlah worker validasi proxy paralel                              |
| `PROXY_URL`                  | -                          | Proxy statis (host/IP)                                            |
| `PROXY_PORT`                 | -                          | Port proxy statis                                                 |
| `PROXY_USER`                 | -                          | Username proxy (opsional)                                         |
| `PROXY_PASS`                 | -                          | Password proxy (opsional)                                         |
| `ORGANIC_SEARCH`             | `false`                    | Navigasi via search engine sebelum ke target                      |
| `SEARCH_ENGINE`              | `google`                   | Search engine: `google`, `bing`, `duckduckgo`, `random`           |
| `SEARCH_KEYWORDS`            | -                          | Kata kunci pencarian, pisah koma                                  |
| `SEARCH_TARGET_TYPE`         | `url`                      | Cara mencocokkan hasil: `url`, `contains`, `text`                 |
| `SEARCH_TARGET_VALUE`        | -                          | Nilai pencocok (default: `DEFAULT_URL`)                           |
| `SEARCH_PAGES_LIMIT`         | `1`                        | Maksimal halaman hasil pencarian yang ditelusuri (1–10)           |
| `REFERRER_POOL`              | -                          | Referrer custom, pisah koma                                       |
| `MATCH_GEOLOCATION`          | `false`                    | Sinkronkan geolokasi browser dengan IP proxy                      |
| `TARGET_IMPRESSIONS`         | `0`                        | Stop otomatis setelah N sesi sukses. `0` = tidak ada target       |
| `LOG_LEVEL`                  | `info`                     | Level log: `error`, `warn`, `info`, `debug`                       |
| `NODE_ENV`                   | `development`              | Environment: `development`, `production`, `test`                  |

> **Catatan `SESSION_TIME`**: nilai integer = detik. `random` = 30–45 detik acak per sesi. Untuk CPM network (Adsterra, dll) cukup `10` — impression sudah terhitung saat ad tag render, dwell time panjang tidak menambah impression baru.

---

## Proxy

Bot mendukung tiga mode proxy:

### 1. Free Proxy Pool (Otomatis)

Set `USE_FREE_PROXIES=true`. Bot akan:
1. Scrape proxy dari **12 sumber** (9 country-specific Tier 1 + 3 global volume)
2. Validasi **3 tahap** secara concurrent — hanya proxy lolos semua tahap yang masuk pool
3. Pool dibagi dua: **Tier 1** (US, GB, CA, AU, DE, NL, FR, SE, JP, KR, …) dan **Other**
4. `next()` mengambil **95% dari Tier 1**, 5% dari Other — maksimalkan CPM
5. Simpan ke `proxy_cache.json` (TTL 6 jam) — restart berikutnya langsung pakai cache
6. **Background refresh setiap 2 jam** — fetch ulang semua sumber, tambah proxy baru ke pool (tanpa restart)

```env
USE_FREE_PROXIES=true
PROXY_VALIDATE_CONCURRENCY=40
```

**Sumber proxy** (12 sumber aktif, Tier 1 country-specific di urutan atas untuk mengisi pool lebih cepat):

| Sumber | Pass Rate | Tier | Keterangan |
|--------|-----------|------|------------|
| proxyscrape US 🇺🇸 | — | Tier 1 | CPM tertinggi, country-tagged |
| proxyscrape GB 🇬🇧 | — | Tier 1 | Country-tagged |
| proxyscrape CA 🇨🇦 | — | Tier 1 | Country-tagged |
| proxyscrape AU 🇦🇺 | — | Tier 1 | Country-tagged |
| proxyscrape FR 🇫🇷 | — | Tier 1 | Country-tagged |
| proxyscrape SE 🇸🇪 | — | Tier 1 | Country-tagged |
| proxyscrape NL 🇳🇱 | ~33% | Tier 1 | Country-tagged |
| proxyscrape DE 🇩🇪 | ~33% | Tier 1 | Country-tagged |
| proxyscrape JP 🇯🇵 | ~17% | Tier 1 | Latency sangat cepat |
| yakumo pre-checked | ~50% | Mix | Pre-validated list terbaik |
| monosans/proxy-list HTTP | ~33% | Mix | Latency cepat (~375ms avg) |
| TheSpeedX/PROXY-List | ~17% | Mix | Volume besar, ada residential GB |

**Validasi 3 tahap** (dioptimalkan untuk hemat quota ip-api.com):

| Tahap | Tes | Keterangan |
|-------|-----|------------|
| 1 | **HTTPS CONNECT** `google.com:443` | Murah, tanpa API call — filter ~70% proxy di sini |
| 2 | **ip-api.com** via proxy | Dapat country + filter `hosting`/`VPN`/`datacenter`. Hanya proxy lolos tahap 1 yang sampai sini |
| 3 | **Target-site probe** (HTTPS ke target) | Filter proxy yang pasti kena `"Anonymous Proxy detected."` sebelum masuk pool |

**Retry logic**: tiap sesi coba maks 5 proxy berbeda → sesi di-skip jika semua proxy gagal (tanpa fallback direct).

**Runtime blacklist**: proxy yang terkena blokir saat session langsung dihapus permanen dari pool — tidak masuk rotasi lagi di putaran berikutnya.

**Target-site block detection**: setelah navigasi, bot membaca body text halaman. Jika target site menampilkan halaman blokir (`"Anonymous Proxy detected."`, `"Access denied"`, dll), bot segera retry ke proxy berikutnya tanpa membuang durasi sesi penuh.

### 2. Proxy Statis

```env
PROXY_URL=192.168.1.1
PROXY_PORT=8080
PROXY_USER=user       # opsional
PROXY_PASS=pass       # opsional
```

---

## Organic Search Simulation

Bot bisa mensimulasikan traffic organik yang berasal dari search engine:

```env
ORGANIC_SEARCH=true
SEARCH_ENGINE=google
SEARCH_KEYWORDS=traffic bot,ai agent,web automation
SEARCH_TARGET_TYPE=url
SEARCH_TARGET_VALUE=https://your-target-url.com/
SEARCH_PAGES_LIMIT=3
```

Alur: buka Google → ketik keyword (human typing) → handle consent popup → scroll SERP (human-like) → klik link target → lanjutkan sesi di target site.

---

## Browser Seeding (Persistent Profiles)

Bangun reputasi browser jangka panjang dengan menyimpan cookies dan cache:

```env
PERSISTENT_SESSIONS=true
SESSIONS_DATA_DIR=./sessions
```

Setiap sesi membaca/menulis ke direktori profilnya sendiri (`sessions/session-0`, dst).

---

## Stealth & Anti-Detection

### Fingerprint Spoofing (injeksi JS sebelum halaman load)
- **Canvas Randomization**: Noise non-destruktif pada pixel data — fingerprint unik tiap sesi
- **WebGL Spoofing**: Vendor/renderer GPU palsu (Apple M1, NVIDIA GTX 1050Ti, Intel HD 640)
- **Hardware Spoofing**: Randomisasi `deviceMemory` (8/16GB), `hardwareConcurrency` (4/8/12/16)
- **Navigator Consistency**: `platform`, `userAgent`, `languages`, `appVersion` konsisten satu sama lain
- **Screen Consistency**: `screen.width/height`, `window.innerWidth/Height`, `devicePixelRatio` sinkron dengan viewport
- **Plugin Spoofing**: 5 plugin PDF realistis (bukan array kosong)
- **WebRTC Leak Protection**: `RTCPeerConnection` di-wrap untuk cegah kebocoran IP asli
- **Permissions API**: `notifications` query selalu return `'default'` (bukan prompt)
- **window.chrome Mock**: `loadTimes()` dan `csi()` tersedia seperti Chrome nyata

### Human Behavior Simulation
- **Smooth Scrolling**: Gerakan scroll bertahap (5 langkah), bukan instan
- **Reading Simulation**: Pause 2–5 detik dengan micro-jitter mouse ±5px
- **Weighted Link Selection**: Prioritas link konten (About, Product, Pricing) vs non-konten (Login, Terms)
- **Human Typing**: Ketik keyword di search engine dengan delay acak 50–150ms per karakter

### Fingerprint Layer
- **User-Agent Pool**: Chrome 140+ dan Edge 140+ (2025/2026) dari `useragent/most-common.json`
- **Minor Version Randomization**: Build number Chrome diacak tiap sesi (bukan `.0.0.0` yang terlalu rapi)
- **Client Hints**: Header `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` sinkron dengan UA
- **Geolocation Matching**: Koordinat browser sinkron dengan IP proxy via `ip-api.com/{proxyHost}`

---

## Live Dashboard

HTTP server berjalan di `PORT` (default 3000). **Mobile-friendly** — responsif di HP dan desktop.

| Endpoint | Keterangan |
|---|---|
| `GET /` | Dashboard HTML — monitoring real-time via Server-Sent Events, mobile-friendly |
| `GET /events` | SSE stream — push state ke browser tiap ada update |
| `GET /health` | JSON status — cocok untuk cronjob/uptime monitor |

Dashboard menampilkan kotak **"⚡ Aksi Bot Sekarang"** yang terupdate setiap langkah secara real-time:
- `🚀 Meluncurkan browser stealth mode...`
- `🌐 Membuka halaman: https://dramacina--dzeckart.replit.app`
- `✅ Halaman target berhasil dimuat`
- `⏳ Menunggu script iklan selesai load (3s)...`
- `📺 Ad warm-up ↓ step 4/12 — memicu IntersectionObserver iklan...`
- `📜 Scroll ↓ 340px` / `🖱️ Gerakkan mouse ke (872, 441)` / `📖 Membaca konten halaman... (3.2s)`
- `🖱️ Klik: "About Drama" → https://dramacina--dzeckart.replit.app/about`

```json
// GET /health
{"status":"ok","uptime":206,"sessions":9,"successRate":"100.0%"}
```

### Untuk Deployment (Autoscale + Cronjob)
Karena autoscale tidur jika tidak ada request, ping `/health` setiap 1 menit via layanan seperti [cron-job.org](https://cron-job.org) (gratis) untuk menjaga bot tetap aktif:
```
https://<nama-repl>.replit.app/health
```

**Konfigurasi deployment yang benar** (sudah terset di `.replit`):
- **Build**: `npm run build && npx puppeteer browsers install chrome-headless-shell`
- **Run**: `bash start.sh`

---

## Arsitektur Distributed (Redis)

Mendukung scaling horizontal via BullMQ + Redis:

| Role | Deskripsi |
|---|---|
| `producer` | Isi queue, tidak launch browser |
| `worker` | Ambil job dari queue, eksekusi browser |
| `both` | Default — satu node bertindak sebagai keduanya |

**Tanpa Redis**: mode `both` otomatis fallback ke eksekusi sequential lokal.

---

## Struktur Project

```
src/
├── main.ts                              # Entry point, role logic, graceful shutdown
├── application/traffic/
│   └── TrafficOrchestrator.ts           # Inti logika sesi (referrer, navigate, behavior, click)
├── domain/
│   ├── entities/Session.ts             # State container sesi
│   └── interfaces/BrowserEngine.ts    # Abstraksi engine browser
└── infrastructure/
    ├── browser/
    │   ├── PuppeteerStealthEngine.ts   # Engine Puppeteer + stealth plugin
    │   ├── FingerprintService.ts       # Generate + inject fingerprint spoofing script
    │   ├── BehaviorService.ts          # Simulasi scroll, mouse, reading pause — emit StateService real-time per aksi
    │   ├── UserAgentService.ts         # Rotasi UA dari useragent/most-common.json
    │   └── ReferrerService.ts          # Manajemen referrer + search engine homepage
    ├── proxy/
    │   ├── ProxyService.ts             # Scrape, validasi 3-tahap streaming, cache proxy (12 sumber, 95% Tier 1)
    ├── queue/
    │   └── QueueService.ts             # BullMQ/Redis wrapper + fallback lokal
    ├── monitoring/
    │   ├── DashboardServer.ts          # HTTP server + SSE dashboard + /health
    │   ├── MetricsService.ts           # Singleton metrics tracker
    │   ├── StateService.ts             # Live state EventEmitter → SSE broadcast
    │   └── ReputationService.ts        # Query ip-api.com untuk geolokasi proxy (dipakai TrafficOrchestrator)
    ├── logging/
    │   └── logger.ts                   # Winston + dashboard transport
    └── config/
        └── config.ts                   # Validasi env vars dengan Zod

scripts/
├── test-fingerprint.ts                # Uji fingerprint injection
├── verify-hardening.ts                # Verifikasi stealth hardening
└── download-browsers.ts               # Download Chrome for Testing

useragent/most-common.json             # Database UA Chrome/Edge 140+ (sumber utama)
proxy_cache.json                       # Cache proxy valid (auto-generated, TTL 6 jam)
```

---

## Lisensi

MIT — Lucas Coelho de Oliveira Lima
