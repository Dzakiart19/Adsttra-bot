/**
 * UptimeService — persistent uptime tracker.
 *
 * Menyimpan uptime_stats.json ke disk sehingga data survive restart.
 * Saat bot restart, firstStartAt TIDAK berubah — hanya restartCount yang naik.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { logger } from '../logging/logger';

interface UptimeStats {
  firstStartAt: number;   // timestamp pertama kali bot pernah jalan (tidak pernah berubah)
  restartCount: number;   // berapa kali bot pernah restart
  lastStartAt:  number;   // timestamp restart/start terakhir
}

const STATS_FILE = path.resolve(process.cwd(), 'uptime_stats.json');

export class UptimeService {
  private static stats: UptimeStats;

  /**
   * Panggil sekali saat bootstrap.
   * Baca file lama → increment restartCount → tulis balik.
   */
  static init(): UptimeStats {
    let existing: UptimeStats | null = null;
    try {
      if (fs.existsSync(STATS_FILE)) {
        const raw = fs.readFileSync(STATS_FILE, 'utf-8').trim();
        if (raw) existing = JSON.parse(raw) as UptimeStats;
      }
    } catch {
      /* file corrupt / pertama kali — mulai fresh */
    }

    const now = Date.now();

    this.stats = {
      firstStartAt: existing?.firstStartAt ?? now,
      // Pertama kali (existing null) → 0. Restart berikutnya → naik 1 tiap start.
      restartCount: existing ? (existing.restartCount ?? 0) + 1 : 0,
      lastStartAt:  now,
    };

    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch (e: any) {
      logger.warn(`[UptimeService] Gagal simpan stats: ${e.message}`);
    }

    const totalSec = Math.floor((now - this.stats.firstStartAt) / 1000);
    logger.info('[UptimeService] Stats loaded', {
      firstStartAt: new Date(this.stats.firstStartAt).toISOString(),
      restartCount: this.stats.restartCount,
      totalUptime: UptimeService.fmtDuration(totalSec),
    });

    return this.stats;
  }

  static getStats(): UptimeStats {
    return { ...this.stats };
  }

  /** Durasi sejak pertama kali bot pernah jalan (dalam detik). */
  static getTotalSec(): number {
    return Math.floor((Date.now() - this.stats.firstStartAt) / 1000);
  }

  /** Durasi sejak restart terakhir (dalam detik). */
  static getSessionSec(): number {
    return Math.floor((Date.now() - this.stats.lastStartAt) / 1000);
  }

  static fmtDuration(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}h ${h}j ${m}m`;
    if (h > 0) return `${h}j ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}
