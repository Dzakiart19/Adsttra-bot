/**
 * WebshareProxyService — Proxy premium Webshare.io sebagai prioritas utama.
 *
 * Logika:
 * 1. Proxy Webshare dipakai tanpa reputation check dan tanpa filter negara.
 * 2. Jika gagal N kali berturut-turut → dianggap limit bulanan tercapai.
 * 3. Setelah limit → fallback otomatis ke scraped proxy pool.
 * 4. Setelah 30 hari → reset otomatis, Webshare aktif kembali sebagai prioritas.
 * 5. State disimpan ke webshare_state.json agar persistent saat restart.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { logger } from '../logging/logger';

export interface WebshareProxy {
  host:     string;
  port:     number;
  username: string;
  password: string;
}

interface WebshareState {
  limitReachedAt:      number | null;
  consecutiveFailures: number;
  updatedAt:           string;
}

const STATE_FILE = path.resolve(process.cwd(), 'webshare_state.json');
const RESET_MS   = 30 * 24 * 60 * 60 * 1000; // 30 hari

export class WebshareProxyService {
  private proxies:              WebshareProxy[] = [];
  private cursor:               number          = 0;
  private consecutiveFailures:  number          = 0;
  private limitReachedAt:       number | null   = null;
  private readonly maxFailures: number;

  constructor(proxyListEnv: string, maxFailures = 10) {
    this.maxFailures = maxFailures;
    this.proxies     = this.parseList(proxyListEnv);
    this.loadState();

    if (this.proxies.length > 0) {
      const status = this.isLimited
        ? `⛔ limit aktif (reset ${this.resetInDays()})`
        : '✅ aktif sebagai prioritas';
      logger.info(
        `[WebshareService] ${this.proxies.length} proxy dimuat — ${status}`,
        { proxies: this.proxies.map(p => `${p.host}:${p.port}`) },
      );
    }
  }

  /**
   * Apakah Webshare bisa dipakai saat ini.
   * false jika: tidak ada proxy, atau limit aktif dan belum 30 hari.
   */
  isActive(): boolean {
    if (this.proxies.length === 0) return false;
    if (!this.limitReachedAt)     return true;
    // Auto-reset setelah 30 hari
    if (Date.now() - this.limitReachedAt >= RESET_MS) {
      this.resetLimit();
      return true;
    }
    return false;
  }

  /** Ambil proxy berikutnya (round-robin) */
  next(): WebshareProxy {
    const proxy = this.proxies[this.cursor % this.proxies.length];
    this.cursor++;
    return proxy;
  }

  /** Dipanggil saat sesi sukses — reset consecutive failure counter */
  onSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
      this.saveState();
    }
  }

  /**
   * Dipanggil saat sesi gagal karena proxy error.
   * Chrome launch error TIDAK dihitung (bukan kesalahan Webshare).
   */
  onFailure(): void {
    this.consecutiveFailures++;
    logger.warn(
      `[WebshareService] Consecutive failures: ${this.consecutiveFailures}/${this.maxFailures}`,
    );
    if (this.consecutiveFailures >= this.maxFailures) {
      this.limitReachedAt = Date.now();
      logger.warn(
        `[WebshareService] ⚠️ ${this.maxFailures}x gagal berturut-turut — ` +
        `limit bulanan diasumsikan tercapai. Fallback ke scraped proxies. ` +
        `Reset otomatis 30 hari = ${new Date(this.limitReachedAt + RESET_MS).toLocaleDateString('id-ID')}.`,
      );
    }
    this.saveState();
  }

  get size():      number  { return this.proxies.length; }
  get isLimited(): boolean {
    return !!this.limitReachedAt && (Date.now() - this.limitReachedAt < RESET_MS);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resetLimit(): void {
    this.limitReachedAt      = null;
    this.consecutiveFailures = 0;
    logger.info('[WebshareService] ✅ 30 hari reset — Webshare aktif kembali sebagai prioritas!');
    this.saveState();
  }

  private resetInDays(): string {
    if (!this.limitReachedAt) return '–';
    const remaining = RESET_MS - (Date.now() - this.limitReachedAt);
    const days      = Math.ceil(remaining / 86_400_000);
    return `${days} hari lagi`;
  }

  /**
   * Parse format: host:port:username:password,host:port:username:password,...
   */
  private parseList(raw: string): WebshareProxy[] {
    if (!raw || !raw.trim()) return [];
    const result: WebshareProxy[] = [];
    for (const entry of raw.split(',')) {
      const parts = entry.trim().split(':');
      if (parts.length !== 4) {
        logger.warn(`[WebshareService] Format entry tidak valid (skip): "${entry.trim()}"`);
        continue;
      }
      const [host, portStr, username, password] = parts;
      const port = parseInt(portStr, 10);
      if (!host || isNaN(port) || !username || !password) continue;
      result.push({ host, port, username, password });
    }
    return result;
  }

  private loadState(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const data           = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as WebshareState;
      this.limitReachedAt      = data.limitReachedAt      ?? null;
      this.consecutiveFailures = data.consecutiveFailures ?? 0;
    } catch {
      // File corrupt — mulai fresh
    }
  }

  private saveState(): void {
    try {
      const state: WebshareState = {
        limitReachedAt:      this.limitReachedAt,
        consecutiveFailures: this.consecutiveFailures,
        updatedAt:           new Date().toISOString(),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch { /* ignore write error */ }
  }
}
