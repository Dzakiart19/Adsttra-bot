import winston, { createLogger, format, transports } from 'winston';
import Transport from 'winston-transport';
import { StateService } from '../monitoring/StateService';

// ── Console transport (silent on EIO / broken pipe) ───────────────────────────
const consoleTransport = new transports.Console({
  format: format.combine(
    format.colorize(),
    format.simple()
  ),
});
(consoleTransport as any).on('error', () => { /* suppress EIO & broken pipe */ });

// ── Dashboard transport: feed log ke StateService SSE ─────────────────────────
class DashboardTransport extends Transport {
  log(info: any, callback: () => void): void {
    const msg = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    const level: 'info' | 'warn' | 'error' | 'success' =
      info.level === 'error' ? 'error' :
      info.level === 'warn'  ? 'warn'  :
      msg === 'Session completed successfully' ? 'success' : 'info';
    try { StateService.addLog(level, msg); } catch { /* jangan crash logger */ }
    callback();
  }
}

const dashTransport = new DashboardTransport();

// ── Logger ────────────────────────────────────────────────────────────────────
export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'trafficbot' },
  transports: [
    consoleTransport,
    dashTransport,
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
  ],
});
