/**
 * ProxyService — streaming proxy validator.
 *
 * Alur baru (optimal):
 * 1. Cache segar (< 6 jam) → langsung pakai, SELESAI (sangat cepat).
 * 2. Cache expired / tidak ada → mulai fetch + validasi concurrent.
 *    • Setiap proxy yang LOLOS langsung masuk pool & ditulis ke JSON.
 *    • Bot sudah bisa mulai begitu MIN_READY proxy tersedia.
 *    • Validasi lanjut di background — pool terus bertambah.
 *    • JSON di-flush setiap FLUSH_INTERVAL_MS atau setiap FLUSH_BATCH proxy baru.
 *    • Satu flush final saat semua selesai.
 */

import * as http  from 'http';
import * as https from 'https';
import * as net   from 'net';
import * as fs    from 'fs';
import * as path  from 'path';
import { logger } from '../logging/logger';

export interface ProxyEntry {
  host:     string;
  port:     number;
  country?: string;   // ISO 3166-1 alpha-2, e.g. "US", "GB", "DE"
}

interface ProxyCache {
  savedAt: number;
  proxies: ProxyEntry[];
}

// ── Config ─────────────────────────────────────────────────────────────────────
const CACHE_FILE        = path.resolve(process.cwd(), 'proxy_cache.json');
const CACHE_TTL_MS      = 6 * 60 * 60 * 1000; // 6 jam
const VALIDATE_TIMEOUT  = 3000;                // ms per proxy
const MIN_READY         = 1;                   // bot mulai setelah ini
const FLUSH_BATCH       = 10;                  // tulis JSON setiap N proxy baru
const FLUSH_INTERVAL_MS = 5000;                // atau setiap 5 detik

// ── Sumber proxy publik ────────────────────────────────────────────────────────
// Diurutkan berdasarkan HASIL TEST LIVE (2-step: HTTP ip-api.com + HTTPS CONNECT):
//
// TIER A — Proven top performers (≥33% pass rate dari test langsung):
//   proxyscrape NL (50%), monosans (33%), proxyscrape US (33%), zevtyardt (33%)
//   → Masuk pool PERTAMA, bot mulai dengan proxy paling andal
//
// TIER B — Mid performers (17% pass rate, tetap berguna untuk volume):
//   spys.me, proxyscrape FR, geonode elite, yakumo checked, TheSpeedX, proxyscrape JP
//
// TIER C — Country-specific lain (0% di test tapi volume kecil, ada potensi):
//   Residential yang kebetulan masuk daftar tetap lolos 2-step validator.
//   Sumber campuran lain yang belum terbukti.
//
// TIER D — Konsisten 0% di live test (diproses TERAKHIR di background):
//   proxifly semua variant (0% di SEMUA test), jetkai/vakhov/almroot (dead saat test),
//   proxyscrape ALL (jumbo tapi hampir 100% datacenter)
//
// `country` opsional: jika diisi, skip query ip-api.com saat validasi (fast-path).
const API_SOURCES: Array<{ name: string; url: string; country?: string; parseMode?: 'lines' | 'regex' | 'json-geonode' }> = [

  // ════════════════════════════════════════════════════════════════════════════
  // TIER A — Proven top performers (diproses PERTAMA, masuk pool paling cepat)
  // Live test result: 33–50% pass rate (2-step: ip-api.com + HTTPS CONNECT google)
  // ════════════════════════════════════════════════════════════════════════════

  {
    // #1 — 50% pass rate. Best performer keseluruhan di live test.
    name: 'proxyscrape NL 🇳🇱',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=NL&ssl=all&anonymity=all',
    country: 'NL',
  },
  {
    // #2 — 33% pass rate. Volume 255 proxy, ISP mix US bagus.
    name: 'monosans/proxy-list HTTP',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  },
  {
    // #3 — 33% pass rate. Volume 215 proxy.
    name: 'proxyscrape US 🇺🇸',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=US&ssl=all&anonymity=all',
    country: 'US',
  },
  {
    // #4 — 33% pass rate. Volume 8143 proxy — terbesar yang masih perform bagus.
    name: 'zevtyardt/proxy-list HTTP',
    url: 'https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER B — Mid performers (17% live pass rate) — diproses kedua
  // ════════════════════════════════════════════════════════════════════════════

  {
    // 17% pass rate. Format "IP:PORT CountryCode-..." → custom regex parser.
    name: 'spys.me',
    url: 'https://spys.me/proxy.txt',
    parseMode: 'regex',
  },
  {
    // 17% pass rate. Proxy FR seringkali residential/ISP.
    name: 'proxyscrape FR 🇫🇷',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=FR&ssl=all&anonymity=all',
    country: 'FR',
  },
  {
    // 17% pass rate. Elite/anonymous filter + 90% uptime. JSON format → parser khusus.
    name: 'geonode elite anonymous',
    url: 'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=90&protocols=http,https&anonymityLevel=elite&anonymityLevel=anonymous',
    parseMode: 'json-geonode',
  },
  {
    // 17% pass rate. Pre-checked = hanya proxy yang respond saat list digenerate.
    name: 'elliottophellia/yakumo HTTP checked',
    url: 'https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt',
  },
  {
    // 17% pass rate. Volume 3011 proxy, ada residential US di dalamnya.
    name: 'TheSpeedX/PROXY-List HTTP',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  },
  {
    // 17% pass rate. Proxy JP kadang ISP residential Asia.
    name: 'proxyscrape JP 🇯🇵',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=JP&ssl=all&anonymity=all',
    country: 'JP',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER C — Country-specific lain + sumber campuran (0% di test, ada potensi)
  // Residential yang "nyasar" ke daftar ini tetap lolos 2-step validator.
  // Divalidasi di background setelah Tier A & B sudah mengisi pool.
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: 'proxyscrape GB 🇬🇧',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=GB&ssl=all&anonymity=all',
    country: 'GB',
  },
  {
    name: 'proxyscrape DE 🇩🇪',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=DE&ssl=all&anonymity=all',
    country: 'DE',
  },
  {
    name: 'proxyscrape CA 🇨🇦',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=CA&ssl=all&anonymity=all',
    country: 'CA',
  },
  {
    name: 'proxyscrape AU 🇦🇺',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=AU&ssl=all&anonymity=all',
    country: 'AU',
  },
  {
    name: 'proxyscrape SE 🇸🇪',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=SE&ssl=all&anonymity=all',
    country: 'SE',
  },
  {
    name: 'proxyscrape DK 🇩🇰',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=DK&ssl=all&anonymity=all',
    country: 'DK',
  },
  {
    name: 'proxyscrape FI 🇫🇮',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=FI&ssl=all&anonymity=all',
    country: 'FI',
  },
  {
    name: 'proxyscrape KR 🇰🇷',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=KR&ssl=all&anonymity=all',
    country: 'KR',
  },
  {
    name: 'sunny9577/proxy-scraper',
    url: 'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt',
  },
  {
    name: 'roosterkid/openproxylist HTTPS',
    url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
  },
  {
    name: 'ShiftyTR/Proxy-List HTTP',
    url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
  },
  {
    name: 'ErcinDedeoglu/proxies HTTP',
    url: 'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt',
  },
  {
    name: 'Anonym0usWork1221/Free-Proxies HTTP',
    url: 'https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/http_proxies.txt',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER D — Konsisten 0% di live test (diproses TERAKHIR di background)
  // proxifly: 0% di SEMUA variant yang ditest (GB/CA/AU/DE dan semua negara)
  // jetkai/vakhov/almroot: dead/timeout saat test (mungkin stale)
  // clarketm: 0% di test
  // proxyscrape ALL: volume jumbo tapi hampir 100% datacenter
  // ════════════════════════════════════════════════════════════════════════════

  {
    // 0% di test. 1800+ proxy tapi mungkin sudah stale/tidak diupdate.
    name: 'jetkai/proxy-list HTTP',
    url: 'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt',
  },
  {
    // 0% di test. Fresh secara label tapi gagal 2-step.
    name: 'vakhov/fresh-proxy-list',
    url: 'https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt',
  },
  {
    // 0% di test.
    name: 'almroot/proxylist',
    url: 'https://raw.githubusercontent.com/almroot/proxylist/master/list.txt',
  },
  {
    // 0% di test.
    name: 'clarketm/proxy-list',
    url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  },
  {
    // proxifly country-specific: 0% di semua 4 negara yang ditest (GB/CA/AU/DE)
    name: 'proxifly GB 🇬🇧',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/GB/data.txt',
    country: 'GB',
  },
  {
    name: 'proxifly CA 🇨🇦',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CA/data.txt',
    country: 'CA',
  },
  {
    name: 'proxifly AU 🇦🇺',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/AU/data.txt',
    country: 'AU',
  },
  {
    name: 'proxifly DE 🇩🇪',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/DE/data.txt',
    country: 'DE',
  },
  {
    name: 'proxifly FR 🇫🇷',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/FR/data.txt',
    country: 'FR',
  },
  {
    // proxifly all: 0% di test, volume 647 tapi mayoritas dead.
    name: 'proxifly/free-proxy-list HTTP',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',
  },
  {
    // Jumbo 1600+ proxy semua negara, mayoritas datacenter — paling terakhir.
    name: 'proxyscrape all',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=all&ssl=all&anonymity=all',
  },
];

// ── Cache helpers ──────────────────────────────────────────────────────────────

function loadCache(): ProxyCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw  = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw) as ProxyCache;
    if (!data.savedAt || !Array.isArray(data.proxies)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(proxies: ProxyEntry[]): void {
  try {
    const data: ProxyCache = { savedAt: Date.now(), proxies: [...proxies] };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e: any) {
    logger.warn(`[ProxyService] Gagal flush cache: ${e.message}`);
  }
}

function cacheAge(cache: ProxyCache): string {
  const ms = Date.now() - cache.savedAt;
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

// ── Network helpers ────────────────────────────────────────────────────────────

function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end',  () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
  });
}

function parseProxyLines(text: string): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.includes('://')) line = line.split('://')[1];
    const [host, portStr] = line.split(':');
    if (host && portStr && /^\d+$/.test(portStr)) {
      out.push({ host, port: parseInt(portStr, 10) });
    }
  }
  return out;
}

/** Ekstrak semua IP:PORT dari teks bebas via regex — cocok untuk spys.me dll */
function parseProxyRegex(text: string): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  const re = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const port = parseInt(m[2], 10);
    if (port >= 80 && port <= 65535) out.push({ host: m[1], port });
  }
  return out;
}

/** Parse response JSON dari Geonode API — format: { data: [{ip, port}, ...] } */
function parseGeonodeJson(text: string): ProxyEntry[] {
  try {
    const j = JSON.parse(text) as { data?: Array<{ ip: string; port: string }> };
    if (!Array.isArray(j.data)) return [];
    return j.data
      .filter(p => p.ip && p.port)
      .map(p => ({ host: p.ip, port: parseInt(p.port, 10) }))
      .filter(p => !isNaN(p.port));
  } catch {
    return [];
  }
}

async function fetchSource(src: { name: string; url: string; country?: string; parseMode?: 'lines' | 'regex' | 'json-geonode' }): Promise<ProxyEntry[]> {
  try {
    const text = await fetchText(src.url);
    let list: ProxyEntry[];
    switch (src.parseMode) {
      case 'regex':        list = parseProxyRegex(text);   break;
      case 'json-geonode': list = parseGeonodeJson(text);  break;
      default:             list = parseProxyLines(text);   break;
    }
    // Jika sumber sudah diketahui negaranya, pre-tag langsung (skip ip-api.com saat validasi)
    const tagged = src.country ? list.map(p => ({ ...p, country: src.country })) : list;
    logger.debug(`[ProxyService] ${src.name}: ${tagged.length} proxy${src.country ? ` [${src.country}]` : ''}`);
    return tagged;
  } catch (e: any) {
    logger.debug(`[ProxyService] ${src.name} gagal: ${e.message}`);
    return [];
  }
}

// ── Tier 1 CPM negara prioritas (CPM tertinggi) ───────────────────────────────
const TIER1_COUNTRIES = new Set([
  'US', 'GB', 'CA', 'AU', 'NZ',   // Top tier
  'DE', 'FR', 'NL', 'SE', 'NO',   // Western Europe
  'DK', 'FI', 'CH', 'AT', 'IE',   // Nordics + DACH + Ireland
  'BE', 'SG', 'JP', 'KR',          // SEA + East Asia
]);

// ── Validator ──────────────────────────────────────────────────────────────────
//
// Semua proxy divalidasi via ip-api.com/json:
//   → cek konektivitas sekaligus verifikasi country asli dari proxy
//   → country dari source tag tidak selalu akurat, ip-api.com lebih reliable
//   → Google 204 diblokir oleh banyak proxy IP, jadi tidak digunakan

function validateProxyFull(proxy: ProxyEntry): Promise<{ ok: boolean; country?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: { ok: boolean; country?: string }) => {
      if (!done) { done = true; resolve(result); }
    };
    try {
      const req = http.request({
        host:    proxy.host,
        port:    proxy.port,
        method:  'GET',
        path:    'http://ip-api.com/json',
        headers: {
          Host:               'ip-api.com',
          'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Proxy-Connection': 'keep-alive',
        },
        timeout: VALIDATE_TIMEOUT,
      }, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 400) {
          res.resume();
          finish({ ok: false });
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json    = JSON.parse(body);
            const country = typeof json.countryCode === 'string' ? json.countryCode : undefined;
            finish({ ok: true, country });
          } catch {
            finish({ ok: true }); // proxy works, country unknown
          }
        });
      });
      req.on('error',   () => finish({ ok: false }));
      req.on('timeout', () => { req.destroy(); finish({ ok: false }); });
      req.end();
    } catch {
      finish({ ok: false });
    }
  });
}

/**
 * Test HTTPS CONNECT tunneling — kirim CONNECT ke proxy, cek dapat "200 Connection established".
 * Ini filter kritis: proxy yang gagal CONNECT tidak bisa buka target HTTPS.
 */
function testHttpsConnect(proxy: ProxyEntry): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const socket = net.connect({ host: proxy.host, port: proxy.port }, () => {
        socket.write('CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\nProxy-Connection: keep-alive\r\n\r\n');
      });
      socket.setTimeout(VALIDATE_TIMEOUT);
      socket.once('data', (chunk) => {
        socket.destroy();
        const line = chunk.toString().split('\r\n')[0];
        done(line.includes('200'));
      });
      socket.on('error',   () => done(false));
      socket.on('timeout', () => { socket.destroy(); done(false); });
    } catch {
      done(false);
    }
  });
}

/**
 * Validasi proxy dua tahap:
 * 1. HTTP GET ip-api.com → cek konektivitas + dapat country
 * 2. HTTPS CONNECT google.com:443 → cek dukungan HTTPS tunneling (wajib untuk target HTTPS)
 * Proxy lolos hanya jika KEDUA tahap berhasil.
 */
async function validateProxy(proxy: ProxyEntry): Promise<{ ok: boolean; country?: string }> {
  const httpResult = await validateProxyFull(proxy);
  if (!httpResult.ok) return { ok: false };
  const httpsOk = await testHttpsConnect(proxy);
  if (!httpsOk) return { ok: false };
  return { ok: true, country: httpResult.country };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isTier1(country?: string): boolean {
  return !!country && TIER1_COUNTRIES.has(country);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class ProxyService {
  private tier1:       ProxyEntry[] = [];   // Tier 1 CPM proxies (US, UK, CA, ...)
  private other:       ProxyEntry[] = [];   // proxies dari negara lain
  private cursor1:     number       = 0;
  private cursorOther: number       = 0;

  private get pool(): ProxyEntry[] { return [...this.tier1, ...this.other]; }
  private addToPool(entry: ProxyEntry): void {
    if (isTier1(entry.country)) this.tier1.push(entry);
    else                        this.other.push(entry);
  }

  /**
   * Muat proxy pool dengan streaming validator.
   *
   * • Cache segar → selesai instan.
   * • Cache expired / tidak ada:
   *     - Resolve Promise begitu MIN_READY proxy valid tersedia
   *       (bot bisa langsung mulai).
   *     - Validasi lanjut di background; pool & JSON terus diperbarui.
   *     - Flush JSON setiap FLUSH_BATCH proxy baru ATAU setiap FLUSH_INTERVAL_MS.
   *     - Flush final saat semua selesai.
   */
  async load(concurrency = 40): Promise<void> {
    // ── Fast path: cache segar ─────────────────────────────────────────────────
    const cache = loadCache();
    if (cache && Date.now() - cache.savedAt < CACHE_TTL_MS) {
      const age = cacheAge(cache);
      for (const p of cache.proxies) this.addToPool(p);
      logger.info(
        `[ProxyService] Cache segar (${this.size} proxy, umur ${age}) — ` +
        `Tier1=${this.tier1.length} Other=${this.other.length} ✓`,
      );
      return;
    }

    if (cache) {
      logger.info(`[ProxyService] Cache expired (umur ${cacheAge(cache)}) — mulai streaming validasi...`);
    }

    // ── Fetch semua sumber ─────────────────────────────────────────────────────
    logger.info('[ProxyService] Mengambil proxy dari semua sumber...');
    const results = await Promise.all(API_SOURCES.map(fetchSource));
    const all     = results.flat();

    // Dedup
    const seen   = new Set<string>();
    const unique: ProxyEntry[] = [];
    for (const p of all) {
      const key = `${p.host}:${p.port}`;
      if (!seen.has(key)) { seen.add(key); unique.push(p); }
    }

    logger.info(
      `[ProxyService] ${unique.length} proxy unik ditemukan — streaming validasi dengan ${concurrency} worker...`,
    );

    // ── Streaming validator ────────────────────────────────────────────────────
    return new Promise<void>((resolveLoad) => {
      let readyResolved  = false;
      let sinceLastFlush = 0;
      let lastFlushTime  = Date.now();
      let checked        = 0;
      const queue        = [...unique];

      const flush = () => {
        saveCache(this.pool);
        sinceLastFlush = 0;
        lastFlushTime  = Date.now();
      };

      const maybeFlush = () => {
        const timePassed = Date.now() - lastFlushTime > FLUSH_INTERVAL_MS;
        const batchFull  = sinceLastFlush >= FLUSH_BATCH;
        if (timePassed || batchFull) flush();
      };

      const worker = async () => {
        while (queue.length > 0) {
          const proxy          = queue.shift()!;
          const { ok, country } = await validateProxy(proxy);
          checked++;

          if (ok) {
            const entry: ProxyEntry = { ...proxy, country };
            this.addToPool(entry);
            sinceLastFlush++;
            maybeFlush();

            if (!readyResolved && this.size >= MIN_READY) {
              readyResolved = true;
              flush();
              logger.info(
                `[ProxyService] ✅ ${this.size} proxy valid — bot MULAI sekarang! ` +
                `Tier1=${this.tier1.length} | Validasi ${unique.length - checked} sisanya di background...`,
              );
              resolveLoad();
            }
          }

          if (checked % 300 === 0) {
            logger.info(
              `[ProxyService] Background: ${checked}/${unique.length} diperiksa — ` +
              `${this.size} valid (Tier1=${this.tier1.length})`,
            );
          }
        }
      };

      Promise.all(Array.from({ length: concurrency }, worker))
        .then(() => {
          try {
            flush();
            if (this.size === 0) {
              logger.warn('[ProxyService] Tidak ada proxy valid — bot berjalan tanpa proxy');
              if (!readyResolved) resolveLoad();
            }
            logger.info(
              `[ProxyService] 🏁 Validasi selesai: ${this.size} proxy valid dari ${unique.length}. ` +
              `Tier1=${this.tier1.length} Other=${this.other.length}. Cache diperbarui.`,
            );
          } catch (e: any) {
            logger.warn(`[ProxyService] Background flush error (non-fatal): ${e?.message}`);
          }
        })
        .catch((e: any) => {
          logger.warn(`[ProxyService] Background validation error (non-fatal): ${e?.message}`);
          if (!readyResolved) resolveLoad();
        });
    });
  }

  /**
   * Background refresh — fetch ulang semua sumber setiap intervalMs,
   * validasi proxy baru, tambahkan ke pool (tier1 / other sesuai negara).
   */
  startBackgroundRefresh(
    intervalMs = 2 * 60 * 60 * 1000,
    concurrency = 60,
    onNewProxies?: (size: number) => void,
  ): void {
    const doRefresh = async () => {
      logger.info('[ProxyService] 🔄 Background refresh — mengambil proxy baru dari semua sumber...');
      try {
        const results      = await Promise.all(API_SOURCES.map(fetchSource));
        const existingKeys = new Set(this.pool.map(p => `${p.host}:${p.port}`));
        const candidates   = results.flat().filter(p => !existingKeys.has(`${p.host}:${p.port}`));

        if (candidates.length === 0) {
          logger.info('[ProxyService] Background refresh: tidak ada proxy baru ditemukan.');
          return;
        }

        logger.info(
          `[ProxyService] Background refresh: ${candidates.length} kandidat baru — streaming validasi...`,
        );

        const queue    = [...candidates];
        let newlyAdded = 0;

        const worker = async () => {
          while (queue.length > 0) {
            const proxy           = queue.shift()!;
            const { ok, country } = await validateProxy(proxy);
            if (ok) {
              const key   = `${proxy.host}:${proxy.port}`;
              const exists = this.pool.some(p => `${p.host}:${p.port}` === key);
              if (!exists) {
                const entry: ProxyEntry = { ...proxy, country };
                this.addToPool(entry);
                newlyAdded++;
                if (newlyAdded % FLUSH_BATCH === 0) {
                  saveCache(this.pool);
                  onNewProxies?.(this.size);
                }
              }
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, worker));
        saveCache(this.pool);
        onNewProxies?.(this.size);

        logger.info(
          `[ProxyService] 🏁 Background refresh selesai: +${newlyAdded} proxy baru. ` +
          `Total=${this.size} (Tier1=${this.tier1.length} Other=${this.other.length}).`,
        );
      } catch (e: any) {
        logger.warn(`[ProxyService] Background refresh error (non-fatal): ${e?.message}`);
      }
    };

    setTimeout(() => {
      void doRefresh().then(() => {
        setInterval(() => { void doRefresh(); }, intervalMs);
      });
    }, intervalMs);

    logger.info(
      `[ProxyService] Background refresh terjadwal setiap ${Math.round(intervalMs / 60000)} menit.`,
    );
  }

  /**
   * Ambil proxy berikutnya dengan prioritas Tier 1 (70% Tier1 / 30% Other).
   * Fallback ke pool mana saja yang tersedia.
   */
  next(): ProxyEntry | undefined {
    const hasTier1 = this.tier1.length > 0;
    const hasOther = this.other.length > 0;

    if (!hasTier1 && !hasOther) return undefined;

    // 70% Tier1 jika tersedia, 30% Other (atau fallback jika salah satu kosong)
    const useTier1 = hasTier1 && (!hasOther || Math.random() < 0.70);

    if (useTier1) {
      const proxy = this.tier1[this.cursor1 % this.tier1.length];
      this.cursor1++;
      return proxy;
    } else {
      const proxy = this.other[this.cursorOther % this.other.length];
      this.cursorOther++;
      return proxy;
    }
  }

  get size(): number       { return this.tier1.length + this.other.length; }
  get tier1Count(): number { return this.tier1.length; }
}
