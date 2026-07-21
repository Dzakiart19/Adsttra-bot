# Changelog

Semua perubahan penting pada project ini didokumentasikan di sini.

---

## [2.6.0] - 2026-07-22

### Changed

- **`SESSION_TIME` default direkomendasikan `10` detik** untuk CPM network (Adsterra, EffectiveCPM, dll): Impression dihitung saat ad tag ter-render di browser — terjadi dalam 2–3 detik pertama setelah warm-up (`networkidle2`) selesai. Dwell time panjang (30–45 detik) tidak menambah impression baru, hanya membuang throughput. Dengan `SESSION_TIME=10`, bot bisa menghasilkan 3–4× lebih banyak impression per jam dibanding `random` (30–45 detik).

---

## [2.5.0] - 2026-07-22

### Changed

- **Dashboard Live Log — hanya tampilkan sesi sukses** (`DashboardServer`, `logger`): Bagian "Live Log" di dashboard diubah menjadi **"✓ Sesi Sukses"** — hanya mencatat sesi yang berhasil selesai. Sebelumnya semua event (info, warn, error) ditampilkan bercampur. Pesan `"Session completed successfully"` kini diberi level `success` di `DashboardTransport` sehingga bisa difilter secara akurat di frontend. Placeholder *"Menunggu sesi sukses pertama..."* ditampilkan saat log masih kosong.

---

## [2.4.0] - 2026-07-22

### Added

- **Target-site proxy-block detection** (`TrafficOrchestrator`): Setelah navigasi ke URL target, bot kini memeriksa body text halaman untuk pola blokir proxy (`"Anonymous Proxy detected."`, `"Access denied"`, `"Bot detected"`, dll). Jika terdeteksi, langsung lempar `ERR_PROXY` agar retry logic aktif dan bot coba proxy berikutnya — impression tidak terbuang sia-sia di halaman blokir.

### Fixed

- **Sesi di halaman blokir proxy**: Sebelumnya, jika target site (mis. `effectivecpmnetwork.com`) memblok IP proxy dan menampilkan `"Anonymous Proxy detected."`, bot tidak mendeteksinya dan duduk diam selama durasi sesi penuh tanpa impression terhitung. Kini terdeteksi dalam <2 detik dan langsung retry.

---

## [2.3.0] - 2026-07-20

### Fixed

- **`UserAgentService`**: File UA kosong atau JSON invalid (safari, opera, dll) kini ditangani gracefully — tidak lagi crash, cukup kembalikan array kosong lalu fallback ke semua entry yang tersedia.
- **`ReputationService`**: Bug logika — sebelumnya selalu cek IP server sendiri, bukan IP proxy. Kini mengekstrak host dari `proxyServer` dan query `ip-api.com/{host}` secara langsung agar reputasi IP proxy yang benar-benar diperiksa.
- **`runWorker` (mode distributed/Redis)**: Tambah proxy retry logic konsisten dengan mode lokal — jika proxy gagal (ERR_PROXY, ERR_TIMED_OUT, dll), worker otomatis coba proxy berikutnya dari pool (maks 5 percobaan). `proxyPool` kini diteruskan dari `bootstrap()` ke `runWorker()`.
- **Durasi `random` dipersingkat**: `SESSION_TIME=random` sekarang menghasilkan 20–30 detik (sebelumnya 1–5 menit), berlaku di mode lokal maupun distributed.

---

## [2.2.0] - 2026-07-20

### Added

- **Proxy Cache JSON** (`proxy_cache.json`): Hasil validasi proxy kini disimpan ke disk. Saat bot restart, cache langsung dipakai selama umurnya < 6 jam — skip validasi 6000+ proxy dari awal.
- **Proxy Retry Logic** di `main.ts`: Jika satu proxy gagal (ERR_PROXY, ERR_TIMED_OUT, ERR_TUNNEL, dll), bot otomatis coba proxy berikutnya dari pool (maks 5 percobaan per sesi).
- **Real HTTP GET Validation**: Validasi proxy kini menggunakan real HTTP GET relay melalui proxy ke `ip-api.com` — bukan sekadar TCP CONNECT. Proxy yang lolos validasi dijamin bisa relay traffic HTTP.
- **Replit Support**: Project kini berjalan native di Replit (Node.js 20) tanpa Docker. Workflow `Veneno Traffic Bot` sudah dikonfigurasi.

### Changed

- `ProxyService.load()` signature disederhanakan: parameter `targetUrl` dihapus, kini hanya `concurrency` (default `40`).
- Validasi proxy lebih akurat — proxy yang hanya lolos TCP CONNECT tapi gagal relay HTTP tidak lagi masuk pool.
- `proxy_cache.json` diacak urutan proxy-nya setiap kali refresh untuk distribusi rotasi yang lebih merata.

### Fixed

- Sinkronisasi signature `ProxyService.load()` antara `ProxyService.ts` dan `main.ts` setelah refactor.

---

## [2.1.0] - 2026-03-15

### Added

- **Distributed Architecture** dengan BullMQ + Redis: role `producer`, `worker`, `both`.
- **Organic Search Simulation**: navigasi via Google/Bing/DuckDuckGo sebelum ke target, termasuk pengetikan keyword human-like dan klik dari hasil pencarian.
- **Multi-page Search**: telusuri hingga 10 halaman hasil pencarian untuk menemukan target (`SEARCH_PAGES_LIMIT`).
- **Geolocation Matching** (`MATCH_GEOLOCATION`): koordinat browser disinkronkan dengan IP proxy via ip-api.com.
- **Referrer Spoofing Pool** (`REFERRER_POOL`): custom referrer dari env var, dirotasi per sesi.
- **Proxy Reputation Monitoring** (`ReputationService`): cek apakah IP proxy terdeteksi sebagai hosting/VPN/proxy.
- **Thinking Heatmaps**: durasi stay per langkah navigasi diacak non-linear (weighted random distribution).
- **Weighted Contextual Link Clicking**: prioritas link bernilai tinggi (About, Product, Pricing) via scoring DOM.
- **Consent Popup Handler**: otomatis dismiss cookie consent sebelum interaksi.
- **Free Proxy Auto-Scraper** (`USE_FREE_PROXIES`): scrape dari 8+ sumber publik, validasi concurrent, rotasi per sesi.
- **`BEHAVIOR_INTENSITY`** config: `low`, `medium`, `high` untuk kontrol frekuensi simulasi perilaku.
- **`SEARCH_ENGINE`** config: pilih `google`, `bing`, `duckduckgo`, atau `random`.

### Changed

- `ProxyService` direfactor dari validasi TCP sederhana ke arsitektur cache-first dengan multi-source scraper.
- `TrafficOrchestrator` diperluas dengan pipeline organic search + referrer spoofing.

---

## [2.0.0] - 2026-03-02

### Added

- Arsitektur berlapis: Domain, Application, Infrastructure.
- TypeScript dengan strict type checking.
- Validasi konfigurasi berbasis Zod dengan dukungan environment variable.
- Structured JSON logging via Winston.
- `PuppeteerStealthEngine` dengan `puppeteer-extra-plugin-stealth`.
- User-Agent rotation service (Chrome 140+ database).
- Multi-stage production Dockerfile.
- `docker-compose.yml` dengan Tor proxy pool (`zeta0/alpine-tor`).
- `.env.example` untuk manajemen konfigurasi aman.
- Otomatisasi download browser via `scripts/download-browsers.ts`.
- Otomatisasi system dependency Linux via `scripts/setup-linux.sh`.
- **Advanced Fingerprinting**: Canvas/WebGL randomization, hardware spoofing.
- **Human Behavior Simulation**: smooth scrolling, randomized mouse movement, reading pauses.
- **Modern UA Module**: database Chrome 140+ dengan randomisasi minor version.
- **Diamond Standard Hardening**: AudioContext masking, Font & ClientRects masking, WebRTC leak protection.

### Changed

- Refactor total dari `index.js` monolitik ke struktur TypeScript modular.
- Migrasi dari `nightmare` (obsolete) ke `puppeteer`.
- Model concurrency diperbarui untuk mendukung sesi browser independen yang scalable.
- Secrets tidak lagi dilempar via CLI argument.

### Removed

- Legacy `index.js` monolitik.
- `node_modules` ter-commit.
- Dependensi `nightmare` dan versi lama `minimist`.
- Pengabaian SSL certificate error secara default.
- `log.txt` dan `_config.yml` unstructured.
