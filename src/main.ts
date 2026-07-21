import { TrafficOrchestrator } from './application/traffic/TrafficOrchestrator';
import { PuppeteerStealthEngine } from './infrastructure/browser/PuppeteerStealthEngine';
import { Session } from './domain/entities/Session';
import { Config } from './infrastructure/config/config';
import { logger } from './infrastructure/logging/logger';
import { MetricsService } from './infrastructure/monitoring/MetricsService';
import { QueueService, TrafficJobData } from './infrastructure/queue/QueueService';
import { ProxyService } from './infrastructure/proxy/ProxyService';
import { StateService } from './infrastructure/monitoring/StateService';
import { startDashboard } from './infrastructure/monitoring/DashboardServer';
import { ReputationService } from './infrastructure/monitoring/ReputationService';
import { Job } from 'bullmq';

async function setupMonitoring() {
  const metrics = MetricsService.getInstance();
  setInterval(() => metrics.printSummary(), 10000);
  return metrics;
}

async function runProducer(proxyPool?: ProxyService) {
  logger.info('Role: PRODUCER - Adding initial tasks to queue', {
    count: Config.MAX_SESSIONS,
    url: Config.DEFAULT_URL
  });

  for (let i = 0; i < Config.MAX_SESSIONS; i++) {
    const durationSec = Config.SESSION_TIME === 'random'
      ? (Math.floor(Math.random() * 31) + 30)  // 30–60 detik (cukup untuk ad viewable)
      : parseInt(Config.SESSION_TIME);
    const durationMin = durationSec / 60;       // QueueService memakai menit

    let proxy: TrafficJobData['proxy'] = undefined;
    if (proxyPool && proxyPool.size > 0) {
      const p = proxyPool.next()!;
      proxy = { host: p.host, port: p.port };
    } else if (Config.PROXY_URL) {
      proxy = { host: Config.PROXY_URL, port: Config.PROXY_PORT!, username: Config.PROXY_USER, password: Config.PROXY_PASS };
    }

    await QueueService.addSession({ url: Config.DEFAULT_URL, durationMinutes: durationMin, intensity: Config.BEHAVIOR_INTENSITY, proxy });
  }
}

async function runWorker(proxyPool?: ProxyService) {
  logger.info('Role: WORKER - Listening for tasks...', { concurrency: Config.MAX_SESSIONS });

  QueueService.createWorker(async (job: Job<TrafficJobData>) => {
    logger.info('Worker: Starting job', { jobId: job.id, url: job.data.url });

    const MAX_PROXY_RETRIES = proxyPool && proxyPool.size > 0 ? Math.min(5, proxyPool.size) : 1;
    let sessionSuccess = false;

    for (let attempt = 0; attempt < MAX_PROXY_RETRIES && !sessionSuccess; attempt++) {
      let jobData: TrafficJobData = job.data;
      if (proxyPool && proxyPool.size > 0) {
        const p = proxyPool.next()!;
        const proxyStr = `${p.host}:${p.port}`;

        // ── Reputation pre-check: skip burnt proxy sebelum buka browser ──
        const rep = await ReputationService.checkIP(proxyStr);
        if (rep && (rep.hosting || rep.proxy || rep.vpn)) {
          StateService.update({ proxyRetries: StateService.getState().proxyRetries + 1, proxyBurnt: true, action: `⚠ Worker proxy burnt (${proxyStr}), skip...` });
          logger.warn(`Worker: Proxy burnt — skip tanpa buka browser (${proxyStr})`);
          continue;
        }

        jobData = { ...job.data, proxy: { host: p.host, port: p.port } };
        logger.info(`Worker: Attempt ${attempt + 1}/${MAX_PROXY_RETRIES} — proxy: ${proxyStr}`);
      }

      const engine = new PuppeteerStealthEngine();
      const orchestrator = new TrafficOrchestrator(engine);

      try {
        await orchestrator.runFromJob(job.id!, jobData);
        sessionSuccess = true;
        StateService.update({ successSessions: StateService.getState().successSessions + 1, totalSessions: StateService.getState().totalSessions + 1 });
      } catch (err: any) {
        const isProxyErr = err?.message && (
          err.message.includes('ERR_TIMED_OUT') || err.message.includes('ERR_PROXY') ||
          err.message.includes('ERR_CONNECTION') || err.message.includes('ERR_TUNNEL') ||
          err.message.includes('net::ERR') ||
          err.message.includes('Timed out after waiting') ||
          err.message.includes('Network.enable timed out') ||
          err.message.includes('ProtocolError') ||
          err.message.includes('Target closed') ||
          err.message.includes('Session closed')
        );
        if (isProxyErr && proxyPool && proxyPool.size > 0 && attempt < MAX_PROXY_RETRIES - 1) {
          StateService.update({ proxyRetries: StateService.getState().proxyRetries + 1 });
          logger.warn(`Worker: Proxy gagal, coba berikutnya...`);
        } else {
          StateService.update({ failedSessions: StateService.getState().failedSessions + 1, totalSessions: StateService.getState().totalSessions + 1 });
          logger.error('Worker: Job failed', { jobId: job.id, error: err?.message });
          throw err;
        }
      }
    }
  });
}

async function bootstrap() {
  // ── Start dashboard HTTP server ─────────────────────────────────────────────
  startDashboard();

  StateService.update({ status: 'starting', action: 'Initializing Veneno Traffic Bot v2...' });

  logger.info('Initializing Veneno Traffic Bot v2 (Distributed)', {
    env: Config.NODE_ENV, role: Config.BOT_ROLE, redis: Config.REDIS_URL
  });

  // Initialize Queue
  QueueService.initialize(Config.REDIS_URL);

  if (Config.BOT_ROLE !== 'producer') await setupMonitoring();

  // Load free proxy pool
  let proxyPool: ProxyService | undefined;
  if (Config.USE_FREE_PROXIES) {
    StateService.update({ status: 'loading_proxies', action: 'Memuat dan memvalidasi proxy pool...' });
    proxyPool = new ProxyService();
    await proxyPool.load(Config.PROXY_VALIDATE_CONCURRENCY);
    StateService.update({ proxyPoolSize: proxyPool.size, action: `Proxy pool siap: ${proxyPool.size} proxy valid` });

    // Background refresh setiap 2 jam — fetch ulang semua sumber, tambah proxy baru
    proxyPool.startBackgroundRefresh(2 * 60 * 60 * 1000, 60, (newSize) => {
      StateService.update({ proxyPoolSize: newSize });
    });
  }

  // Execute Roles
  if (Config.BOT_ROLE === 'producer' || Config.BOT_ROLE === 'both') {
    if (QueueService.isDistributedEnabled()) {
      await runProducer(proxyPool);
    } else if (Config.BOT_ROLE === 'both') {
      logger.info('Role: BOTH - Redis unavailable, falling back to local sequential execution');

      const { FingerprintService } = require('./infrastructure/browser/FingerprintService');
      let round = 0;

      do {
        round++;
        try {
          if (Config.LOOP_FOREVER) {
            logger.info(`━━━ Putaran #${round} dimulai (LOOP_FOREVER aktif) ━━━`, {
              sessions: Config.MAX_SESSIONS, url: Config.DEFAULT_URL, proxyPool: proxyPool?.size ?? 0,
            });
          }

          StateService.update({
            status: 'running',
            round,
            sessionsPerRound: Config.MAX_SESSIONS,
            proxyPoolSize: proxyPool?.size ?? 0,
            action: `Putaran #${round} dimulai`,
          });

          for (let i = 0; i < Config.MAX_SESSIONS; i++) {
            const durationMs = Config.SESSION_TIME === 'random'
              ? (Math.floor(Math.random() * 31) + 30) * 1000  // 30–60 detik (cukup untuk ad viewable)
              : parseInt(Config.SESSION_TIME) * 1000;          // SESSION_TIME dalam detik

            // Coba dengan proxy (maks 5 proxy berbeda), lalu fallback direct
            const MAX_PROXY_RETRIES = proxyPool && proxyPool.size > 0 ? Math.min(5, proxyPool.size) : 0;
            let sessionSuccess = false;

            // ── Proxy attempts ──────────────────────────────────────────────────
            for (let attempt = 0; attempt < MAX_PROXY_RETRIES && !sessionSuccess; attempt++) {
              const p = proxyPool!.next()!;
              const proxyStr = `${p.host}:${p.port}`;

              // ── Reputation pre-check: skip burnt proxy sebelum buka browser ──
              StateService.update({
                sessionIndex: i, attempt, maxAttempts: MAX_PROXY_RETRIES + 1,
                proxy: proxyStr, proxyBurnt: false, targetUrl: Config.DEFAULT_URL,
                referrer: null, step: 0,
                action: `Cek reputasi proxy ${proxyStr}...`,
              });
              const rep = await ReputationService.checkIP(proxyStr);
              if (rep && (rep.hosting || rep.proxy || rep.vpn)) {
                StateService.update({ proxyBurnt: true, proxyRetries: StateService.getState().proxyRetries + 1, action: `⚠ Proxy burnt (${proxyStr}), skip → coba berikutnya...` });
                logger.warn(`[R${round}·S${i+1}] Proxy burnt — skip tanpa buka browser (${proxyStr})`);
                continue;
              }

              const fingerprint = FingerprintService.generate();
              const proxyConfig = { server: proxyStr };

              logger.info(`[R${round}·S${i+1}/${Config.MAX_SESSIONS}] Attempt ${attempt + 1}/${MAX_PROXY_RETRIES} (proxy) — ${proxyStr}`);
              StateService.update({
                action: `Memulai sesi R${round}·S${i+1} attempt ${attempt+1} via proxy...`,
              });

              const engine = new PuppeteerStealthEngine();
              try {
                await new TrafficOrchestrator(engine).run(new Session({
                  id: `r${round}-s${i}-try${attempt}`,
                  url: Config.DEFAULT_URL,
                  userAgent: fingerprint.userAgent,
                  viewport: fingerprint.viewport,
                  durationMs,
                  proxy: proxyConfig,
                  userDataDir: Config.PERSISTENT_SESSIONS ? `${Config.SESSIONS_DATA_DIR}/session-${i}` : undefined
                }), {
                  headless: Config.HEADLESS,
                  platform: fingerprint.platform,
                  fingerprintScript: FingerprintService.getInjectionScript(fingerprint)
                });
                sessionSuccess = true;
                const st = StateService.getState();
                StateService.update({ successSessions: st.successSessions + 1, totalSessions: st.totalSessions + 1, step: 0, action: `Sesi R${round}·S${i+1} berhasil ✓ (proxy)` });
              } catch (err: any) {
                StateService.update({ proxyRetries: StateService.getState().proxyRetries + 1, step: 0 });
                logger.warn(`[R${round}·S${i+1}] Proxy ${proxyStr} gagal (${err.message?.split('\n')[0] ?? 'unknown'}), coba berikutnya...`);
              }
            }

            // ── Tidak ada fallback direct — skip sesi jika semua proxy gagal/burnt ──
            if (!sessionSuccess) {
              const st = StateService.getState();
              StateService.update({
                failedSessions: st.failedSessions + 1, totalSessions: st.totalSessions + 1,
                step: 0, proxy: null, proxyBurnt: false,
                action: `Sesi R${round}·S${i+1} di-skip (semua proxy gagal/burnt)`,
              });
              logger.warn(`[R${round}·S${i+1}] Semua proxy gagal/burnt — sesi di-skip (no direct fallback)`);
            }
          }

        } catch (roundErr: any) {
          logger.error(`━━━ Putaran #${round} error (lanjut ke putaran berikutnya) ━━━`, { err: roundErr?.message });
        }

        if (Config.LOOP_FOREVER) {
          if (Config.LOOP_COOLDOWN_SEC > 0) {
            const cooldownEndsAt = Date.now() + Config.LOOP_COOLDOWN_SEC * 1000;
            StateService.update({ status: 'cooldown', cooldownEndsAt, step: 0, action: `Cooldown ${Config.LOOP_COOLDOWN_SEC}s sebelum putaran berikutnya` });
            logger.info(`━━━ Putaran #${round} selesai. Cooldown ${Config.LOOP_COOLDOWN_SEC}s... ━━━${proxyPool ? ` (pool: ${proxyPool.size} proxy)` : ''}`);
            await new Promise(resolve => setTimeout(resolve, Config.LOOP_COOLDOWN_SEC * 1000));
            StateService.update({ status: 'running' });
          } else {
            logger.info(`━━━ Putaran #${round} selesai. Langsung lanjut (no cooldown) ━━━`);
          }
        }

      } while (Config.LOOP_FOREVER);

      if (!Config.LOOP_FOREVER) {
        StateService.update({ status: 'done', action: 'Semua sesi selesai. Set LOOP_FOREVER=true untuk berjalan terus.' });
        logger.info('Semua sesi selesai. Set LOOP_FOREVER=true untuk berjalan terus-menerus.');
      }
    } else {
      logger.error('Role: PRODUCER - Redis unavailable, cannot add tasks.');
    }
  }

  if (Config.BOT_ROLE === 'worker' || Config.BOT_ROLE === 'both') {
    if (QueueService.isDistributedEnabled()) {
      await runWorker(proxyPool);
    } else if (Config.BOT_ROLE === 'worker') {
      logger.error('Role: WORKER - Redis unavailable, cannot listen for tasks.');
    }
  }

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing services...');
    await QueueService.close();
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection (non-fatal, lanjut...)', { reason: reason?.message ?? String(reason) });
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception (non-fatal, lanjut...)', { message: err.message, stack: err.stack });
});

bootstrap().catch(err => {
  logger.error('Fatal crash during bootstrap', { err });
  process.exit(1);
});
