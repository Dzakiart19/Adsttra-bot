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
- **Proxy validation 3 tahap** (urutan dioptimalkan hemat quota ip-api.com):
  1. **HTTPS CONNECT** `google.com:443` — murah, tanpa API; filter ~70% proxy di sini
  2. **ip-api.com via proxy** — dapat country + filter `hosting`/`VPN`/`datacenter` langsung saat validasi
  3. **Target-site probe** (HTTPS ke target) — filter proxy yang pasti kena blokir sebelum masuk pool
- **Background refresh** setiap 2 jam — fetch ulang semua sumber, tambah proxy baru ke pool tanpa restart
- **Sumber proxy aktif** (6 sumber, diurutkan pass rate tertinggi → terendah, live test 2026-07-22):
  - yakumo pre-checked (~50%), monosans (~33%), proxyscrape NL (~33%), proxyscrape DE (~33%), proxyscrape JP (~17%), TheSpeedX (~17%)
  - Sumber 0% pass rate telah dihapus dari daftar — buang waktu validasi
- **Runtime blacklist** — proxy kena `"Anonymous Proxy detected."` saat session langsung dihapus dari pool permanen
- **`ip-api.com`** dipanggil HANYA via proxy selama validasi (bukan dari IP server langsung) — tidak kena rate limit 45 req/menit di runtime
- **`proxyPoolSize`** di dashboard di-update tiap awal putaran (bukan hanya saat startup)
- **`SESSION_TIME`** dalam **detik** (bukan menit). Default aktif: `10` detik. `random` = 30–45 detik jika tidak butuh throughput tinggi
- **Sesi < 60 detik** otomatis pakai 1 step (bukan 4) agar timer dashboard menampilkan durasi penuh
- **`HEADLESS=false`** tidak menampilkan UI browser di Replit (server tanpa display)
- **Dwell time akurat** — `elapsedBeforeDwell` (waktu browser init + navigate + warmup) dikurangi dari `durationMs` agar total sesi tidak melebihi yang dikonfigurasi
- **SSE heartbeat** aktif setiap 30 detik — deteksi dan bersihkan client yang hang (tab ditutup tanpa TCP FIN)

---

## Fix & Improvement Log (Juli 2026)

| # | File | Perubahan | Status |
|---|---|---|---|
| 1 | `UserAgentService.ts` | NULL deref jika file UA kosong → crash | ✅ Fixed |
| 2 | `ReputationService.ts` | Cache tanpa TTL — proxy berubah reputasi tidak pernah di-recheck | ✅ Fixed |
| 3 | `TrafficOrchestrator.ts` | Fire-and-forget `checkIP()` tanpa await — race condition | ✅ Fixed |
| 4 | `TrafficOrchestrator.ts` | Duration drift — warmup + navigate tidak dikurangi dari dwell time | ✅ Fixed |
| 5 | `config.ts` | `SESSION_TIME` default `'3'`, tidak sinkron dengan docs (`10`) | ✅ Fixed |
| 6 | `config.ts` | `PROXY_URL` tidak strip protokol `http://` — bisa break proxy string | ✅ Fixed |
| 7 | `DashboardServer.ts` | Tidak ada SSE heartbeat — hung client tidak terdeteksi | ✅ Fixed |
| 8 | `ProxyService.ts` | Tambah target-site probe (tahap 3) + runtime blacklist (Layer 3) | ✅ Added |
| 9 | `ProxyService.ts` | Ubah urutan validasi: HTTPS CONNECT dulu → ip-api.com — hemat ~70% quota | ✅ Optimized |
| 10 | `ProxyService.ts` | ip-api.com sekarang request fields `hosting+vpn` → filter datacenter saat validasi | ✅ Optimized |
| 11 | `main.ts` | Hapus `ReputationService.checkIP()` runtime — tidak perlu lagi, proxy sudah pre-filtered | ✅ Removed |
| 12 | `main.ts` | Fix scope bug TypeScript: variabel `p` di `runWorker()` keluar dari scope di catch block | ✅ Fixed |

---

## User Preferences

- Komunikasi dalam Bahasa Indonesia
- Project berjalan di Replit (bukan Docker/bare-metal lokal)
- Proxy cache diutamakan — hindari re-validasi setiap restart
- Jaga arsitektur Clean Architecture yang sudah ada (Domain / Application / Infrastructure)
- `SESSION_TIME` dalam satuan **detik** — set `10` untuk CPM network; `random` = 30–45 detik acak
- Tidak ada cooldown antar putaran (`LOOP_COOLDOWN_SEC=0`)
