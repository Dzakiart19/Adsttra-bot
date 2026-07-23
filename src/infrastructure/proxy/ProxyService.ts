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
import * as tls   from 'tls';
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
// Diurutkan berdasarkan live test 2-step (HTTP ip-api.com + HTTPS CONNECT).
// Terakhir ditest: 2026-07-22. Sumber 0% pass rate DIHAPUS — buang waktu validasi.
//
// Urutan: pass rate tertinggi → terendah (streaming validator isi pool dari atas).
// `country` opsional: jika diisi, skip query ip-api.com saat validasi (fast-path).
const API_SOURCES: Array<{ name: string; url: string; country?: string; parseMode?: 'lines' | 'regex' | 'json-geonode' }> = [

  // ── 50% pass rate ─────────────────────────────────────────────────────────
  {
    // Pre-checked list — hanya proxy yang respond saat list digenerate. #1 best source.
    name: 'yakumo pre-checked',
    url: 'https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt',
  },

  // ── 33% pass rate ─────────────────────────────────────────────────────────
  {
    // Latency tercepat (375ms avg) — prioritas untuk isi pool awal.
    name: 'monosans/proxy-list HTTP',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  },
  {
    name: 'proxyscrape NL 🇳🇱',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=NL&ssl=all&anonymity=all',
    country: 'NL',
  },
  {
    name: 'proxyscrape DE 🇩🇪',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=DE&ssl=all&anonymity=all',
    country: 'DE',
  },

  // ── 17% pass rate ─────────────────────────────────────────────────────────
  {
    // Latency sangat cepat (363ms avg) walau pass rate rendah.
    name: 'proxyscrape JP 🇯🇵',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&proxy_type=http&timeout=5000&country=JP&ssl=all&anonymity=all',
    country: 'JP',
  },
  {
    // Volume besar (3011 proxy) — ada residential GB; pass rate 17%.
    name: 'TheSpeedX/PROXY-List HTTP',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
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
 * Tahap 3 (opsional): Test HTTPS ke target site lewat proxy.
 * Tujuan: filter proxy yang pasti kena "Anonymous Proxy detected." sebelum masuk pool.
 * Jalankan CONNECT tunnel → TLS handshake → GET / → cek body untuk pola blokir.
 * Optimistic on TLS/network error (biarkan real session yang putuskan).
 */
function testTargetSiteViaProxy(proxy: ProxyEntry, targetHost: string): Promise<boolean> {
  const BLOCK_PATTERNS = [
    /anonymous proxy detected/i,
    /proxy detected/i,
    /vpn detected/i,
    /your ip.*blocked/i,
    /ip.*has been blocked/i,
  ];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };

    try {
      const socket = net.connect({ host: proxy.host, port: proxy.port }, () => {
        socket.write(
          `CONNECT ${targetHost}:443 HTTP/1.1\r\nHost: ${targetHost}:443\r\nProxy-Connection: keep-alive\r\n\r\n`
        );
      });
      socket.setTimeout(6000);
      socket.on('error', () => finish(false));
      socket.on('timeout', () => { socket.destroy(); finish(false); });

      socket.once('data', (connectBuf: Buffer) => {
        const firstLine = connectBuf.toString().split('\r\n')[0];
        if (!firstLine.includes('200')) { socket.destroy(); finish(false); return; }

        // Tunnel established — upgrade ke TLS
        socket.removeAllListeners('timeout');
        const tlsSock = tls.connect({ socket, servername: targetHost, rejectUnauthorized: false });
        tlsSock.setTimeout(5000);

        tlsSock.on('secureConnect', () => {
          tlsSock.write(
            `GET / HTTP/1.1\r\nHost: ${targetHost}\r\n` +
            `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n` +
            `Accept: text/html\r\nConnection: close\r\n\r\n`
          );
        });

        let response = '';
        tlsSock.on('data', (d: Buffer) => {
          response += d.toString();
          if (response.length > 800) {
            tlsSock.destroy();
            finish(!BLOCK_PATTERNS.some(re => re.test(response)));
          }
        });
        tlsSock.on('end', () => {
          if (!settled) finish(!BLOCK_PATTERNS.some(re => re.test(response)));
        });
        // TLS error → optimistic (biarkan real session yang putuskan)
        tlsSock.on('error', () => { if (!settled) finish(true); });
        tlsSock.on('timeout', () => { tlsSock.destroy(); if (!settled) finish(true); });
      });
    } catch { finish(false); }
  });
}

/**
 * Validasi proxy tiga tahap:
 * 1. HTTP GET ip-api.com → cek konektivitas + dapat country
 * 2. HTTPS CONNECT google.com:443 → cek dukungan HTTPS tunneling
 * 3. (Opsional) HTTPS ke target site → filter proxy yang pasti kena blokir
 * Proxy lolos hanya jika SEMUA tahap berhasil.
 */
async function validateProxy(proxy: ProxyEntry, targetHost?: string): Promise<{ ok: boolean; country?: string }> {
  const httpResult = await validateProxyFull(proxy);
  if (!httpResult.ok) return { ok: false };
  const httpsOk = await testHttpsConnect(proxy);
  if (!httpsOk) return { ok: false };
  if (targetHost) {
    const targetOk = await testTargetSiteViaProxy(proxy, targetHost);
    if (!targetOk) return { ok: false };
  }
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
  private blacklisted  = new Set<string>(); // runtime blacklist — proxy yang diblok target site

  private get pool(): ProxyEntry[] { return [...this.tier1, ...this.other]; }
  private addToPool(entry: ProxyEntry): void {
    const key = `${entry.host}:${entry.port}`;
    if (this.blacklisted.has(key)) return; // jangan tambah proxy yang sudah di-blacklist
    if (isTier1(entry.country)) this.tier1.push(entry);
    else                        this.other.push(entry);
  }

  /**
   * Blacklist proxy secara permanent untuk sesi ini.
   * Panggil saat target site mengembalikan "Anonymous Proxy detected."
   * Proxy dihapus dari pool dan tidak akan di-tambah ulang.
   */
  blacklistProxy(host: string, port: number): void {
    const key = `${host}:${port}`;
    if (this.blacklisted.has(key)) return;
    this.blacklisted.add(key);
    const before = this.size;
    this.tier1 = this.tier1.filter(p => `${p.host}:${p.port}` !== key);
    this.other = this.other.filter(p => `${p.host}:${p.port}` !== key);
    if (this.size < before) {
      logger.debug(`[ProxyService] Blacklisted ${key} (target site block) — pool: ${this.size}`);
    }
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
  async load(concurrency = 40, targetHost?: string): Promise<void> {
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
      if (targetHost) {
        logger.info(`[ProxyService] Target-site probe aktif: akan test HTTPS ke ${targetHost} (tahap 3)`);
      }

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
          const { ok, country } = await validateProxy(proxy, targetHost);
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
    targetHost?: string,
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
            const { ok, country } = await validateProxy(proxy, targetHost);
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
