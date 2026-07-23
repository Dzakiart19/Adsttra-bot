import { TrafficOrchestrator } from './application/traffic/TrafficOrchestrator';
import { PuppeteerStealthEngine } from './infrastructure/browser/PuppeteerStealthEngine';
import { Session } from './domain/entities/Session';
import { Config } from './infrastructure/config/config';
import { logger } from './infrastructure/logging/logger';
import { MetricsService } from './infrastructure/monitoring/MetricsService';
import { QueueService, TrafficJobData } from './infrastructure/queue/QueueService';
import { ProxyService } from './infrastructure/proxy/ProxyService';
import { WebshareProxyService } from './infrastructure/proxy/WebshareProxyService';
import { StateService } from './infrastructure/monitoring/StateService';
import { startDashboard } from './infrastructure/monitoring/DashboardServer';
import { UptimeService } from './infrastructure/monitoring/UptimeService';
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
      ? (Math.floor(Math.random() * 16) + 30)  // 30–45 detik
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
      let p: import('./infrastructure/proxy/ProxyService').ProxyEntry | undefined;
      if (proxyPool && proxyPool.size > 0) {
        p = proxyPool.next()!;
        const proxyStr = `${p.host}:${p.port}`;

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
          // Blacklist jika target site yang memblok
          if (p && (err.message?.includes('Anonymous Proxy detected') || err.message?.includes('ERR_PROXY'))) {
            proxyPool.blacklistProxy(p.host, p.port);
          }
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
  // ── Persistent uptime tracker (baca/tulis uptime_stats.json) ───────────────
  const uptimeStats = UptimeService.init();
  StateService.update({
    firstStartAt: uptimeStats.firstStartAt,
    restartCount: uptimeStats.restartCount,
  });

  // ── Start dashboard HTTP server ─────────────────────────────────────────────
  startDashboard();

  StateService.update({
    status: 'starting',
    action: 'Initializing Veneno Traffic Bot v2...',
    targetImpressions: Config.TARGET_IMPRESSIONS,
  });

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

    // Ekstrak hostname target untuk target-site probe (tahap 3 validasi)
    let targetHostForValidation: string | undefined;
    try { targetHostForValidation = new URL(Config.DEFAULT_URL).hostname; } catch { /* abaikan */ }
    if (targetHostForValidation) {
      logger.info(`[Bootstrap] Target-site probe akan test ke: ${targetHostForValidation}`);
    }

    await proxyPool.load(Config.PROXY_VALIDATE_CONCURRENCY, targetHostForValidation);
    StateService.update({ proxyPoolSize: proxyPool.size, action: `Proxy pool siap: ${proxyPool.size} proxy valid` });

    // Background refresh setiap 2 jam — fetch ulang semua sumber, tambah proxy baru
    proxyPool.startBackgroundRefresh(2 * 60 * 60 * 1000, 60, (newSize) => {
      StateService.update({ proxyPoolSize: newSize });
    }, targetHostForValidation);
  }

  // Load Webshare proxy service (prioritas utama, tanpa reputation check)
  let webshareService: WebshareProxyService | undefined;
  if (Config.WEBSHARE_PROXY_LIST) {
    webshareService = new WebshareProxyService(Config.WEBSHARE_PROXY_LIST, Config.WEBSHARE_MAX_FAILURES);
    if (webshareService.size === 0) {
      logger.warn('[Webshare] Tidak ada proxy valid dari WEBSHARE_PROXY_LIST — periksa format env var.');
      webshareService = undefined;
    }
  }

  // Execute Roles
  if (Config.BOT_ROLE === 'producer' || Config.BOT_ROLE === 'both') {
    if (QueueService.isDistributedEnabled()) {
      await runProducer(proxyPool);
    } else if (Config.BOT_ROLE === 'both') {
      logger.info('Role: BOTH - Redis unavailable, falling back to local sequential execution');

      const { FingerprintService } = require('./infrastructure/browser/FingerprintService');
      let round = 0;

      // ── Circuit breaker: Chrome launch failures ─────────────────────────────
      // Jika Chrome gagal launch berulang kali (bukan masalah proxy),
      // bot pause dulu sebelum retry agar tidak spam.
      let consecutiveChromeFails = 0;
      const MAX_CHROME_FAILS_BEFORE_PAUSE = 3;
      const CHROME_FAIL_PAUSE_MS = 60_000; // 60 detik pause saat Chrome terus gagal

      /** Deteksi apakah error berasal dari Chrome gagal launch (bukan proxy) */
      function isChromeLaunchError(err: any): boolean {
        const msg: string = err?.message ?? '';
        return (
          msg.includes('Failed to launch the browser process') ||
          msg.includes('Failed to launch browser') ||
          msg.includes('spawn') && msg.includes('ENOENT') ||
          /Code:\s*12[0-9]/.test(msg) // exit code 12x (127 = lib missing, 126 = permission)
        );
      }

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
              ? (Math.floor(Math.random() * 16) + 30) * 1000  // 30–45 detik
              : parseInt(Config.SESSION_TIME) * 1000;          // SESSION_TIME dalam detik

            // Coba dengan proxy (maks 5 proxy berbeda), lalu fallback direct
            const MAX_PROXY_RETRIES = proxyPool && proxyPool.size > 0 ? Math.min(5, proxyPool.size) : 0;
            let sessionSuccess = false;

            // ── Webshare priority attempt (tanpa reputation check, tanpa filter negara) ──
            if (webshareService && webshareService.isActive() && !sessionSuccess) {
              const wp = webshareService.next();
              const wsProxyStr = `${wp.host}:${wp.port}`;
              StateService.update({
                sessionIndex: i, attempt: 0, maxAttempts: MAX_PROXY_RETRIES + 1,
                proxy: `[WS] ${wsProxyStr}`, proxyBurnt: false,
                targetUrl: Config.DEFAULT_URL, referrer: null, step: 0,
                action: `[Webshare] Memulai sesi via ${wsProxyStr}...`,
              });
              logger.info(`[R${round}·S${i+1}/${Config.MAX_SESSIONS}] Webshare proxy: ${wsProxyStr}`);

              const wsFingerprint = FingerprintService.generate();
              const wsEngine = new PuppeteerStealthEngine();
              try {
                await new TrafficOrchestrator(wsEngine).run(new Session({
                  id: `r${round}-s${i}-ws`,
                  url: Config.DEFAULT_URL,
                  userAgent: wsFingerprint.userAgent,
                  viewport: wsFingerprint.viewport,
                  durationMs,
                  proxy: { server: wsProxyStr, username: wp.username, password: wp.password },
                  userDataDir: Config.PERSISTENT_SESSIONS ? `${Config.SESSIONS_DATA_DIR}/session-${i}` : undefined,
                }), {
                  headless: Config.HEADLESS,
                  platform: wsFingerprint.platform,
                  fingerprintScript: FingerprintService.getInjectionScript(wsFingerprint),
                });
                sessionSuccess = true;
                webshareService.onSuccess();
                consecutiveChromeFails = 0;
                const stWs = StateService.getState();
                const newSuccessWs = stWs.successSessions + 1;
                StateService.update({ successSessions: newSuccessWs, totalSessions: stWs.totalSessions + 1, step: 0, action: `Sesi R${round}·S${i+1} berhasil ✓ (Webshare)` });
                if (Config.TARGET_IMPRESSIONS > 0 && newSuccessWs >= Config.TARGET_IMPRESSIONS) {
                  logger.info(`🎯 TARGET ${Config.TARGET_IMPRESSIONS} impressions TERCAPAI! Bot berhenti.`);
                  StateService.update({ status: 'done', action: `🎯 Target ${Config.TARGET_IMPRESSIONS} impressions tercapai — bot selesai!` });
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  process.exit(0);
                }
              } catch (wsErr: any) {
                if (isChromeLaunchError(wsErr)) {
                  // Chrome fail bukan masalah Webshare — jangan count sebagai failure
                  consecutiveChromeFails++;
                  const wsCode = wsErr.message?.match(/Code:\s*(\d+)/)?.[1] ?? 'unknown';
                  logger.error(`[R${round}·S${i+1}] ⛔ Chrome gagal launch (exit ${wsCode}) saat Webshare attempt`);
                  StateService.update({ step: 0, action: `⛔ Chrome gagal launch (exit ${wsCode}) — lihat log` });
                  if (consecutiveChromeFails >= MAX_CHROME_FAILS_BEFORE_PAUSE) {
                    StateService.update({ status: 'cooldown', cooldownEndsAt: Date.now() + CHROME_FAIL_PAUSE_MS, action: `⛔ Circuit breaker aktif — pause ${CHROME_FAIL_PAUSE_MS / 1000}s...` });
                    await new Promise(resolve => setTimeout(resolve, CHROME_FAIL_PAUSE_MS));
                    StateService.update({ status: 'running' });
                    consecutiveChromeFails = 0;
                  }
                } else {
                  // Proxy/network error — hitung sebagai Webshare failure
                  webshareService.onFailure();
                  logger.warn(`[R${round}·S${i+1}] Webshare gagal (${wsErr.message?.split('\n')[0]}) — fallback ke scraped proxies`);
                }
              }
            }

            // ── Proxy attempts (scraped pool, fallback jika Webshare gagal/limit) ─────
            for (let attempt = 0; attempt < MAX_PROXY_RETRIES && !sessionSuccess; attempt++) {
              const p = proxyPool!.next()!;
              const proxyStr = `${p.host}:${p.port}`;

              StateService.update({
                sessionIndex: i, attempt, maxAttempts: MAX_PROXY_RETRIES + 1,
                proxy: proxyStr, proxyBurnt: false, targetUrl: Config.DEFAULT_URL,
                referrer: null, step: 0,
                action: `Memulai sesi R${round}·S${i+1} attempt ${attempt+1} via proxy...`,
              });

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
                consecutiveChromeFails = 0; // reset circuit breaker saat sesi berhasil
                const st = StateService.getState();
                const newSuccess = st.successSessions + 1;
                StateService.update({ successSessions: newSuccess, totalSessions: st.totalSessions + 1, step: 0, action: `Sesi R${round}·S${i+1} berhasil ✓ (proxy)` });

                // ── TARGET_IMPRESSIONS: berhenti otomatis jika target tercapai ──
                if (Config.TARGET_IMPRESSIONS > 0 && newSuccess >= Config.TARGET_IMPRESSIONS) {
                  logger.info(`🎯 TARGET ${Config.TARGET_IMPRESSIONS} impressions TERCAPAI! Bot berhenti.`);
                  StateService.update({ status: 'done', action: `🎯 Target ${Config.TARGET_IMPRESSIONS} impressions tercapai — bot selesai!` });
                  await new Promise(resolve => setTimeout(resolve, 2000)); // beri waktu dashboard update
                  process.exit(0);
                }
              } catch (err: any) {
                const msg = err?.message ?? '';

                if (isChromeLaunchError(err)) {
                  // ── Chrome gagal launch — bukan masalah proxy ───────────────
                  // Retry dengan proxy berbeda TIDAK akan membantu.
                  // Break dari proxy loop, tambah counter circuit breaker.
                  consecutiveChromeFails++;
                  const codeMatch = msg.match(/Code:\s*(\d+)/);
                  const exitCode = codeMatch ? codeMatch[1] : 'unknown';
                  logger.error(
                    `[R${round}·S${i+1}] ⛔ Chrome gagal launch (exit ${exitCode}) — bukan masalah proxy. ` +
                    `consecutiveFails=${consecutiveChromeFails}/${MAX_CHROME_FAILS_BEFORE_PAUSE}`
                  );
                  StateService.update({
                    step: 0,
                    action: `⛔ Chrome gagal launch (exit ${exitCode}) — lihat log untuk detail`,
                  });

                  // Circuit breaker: jika terlalu banyak Chrome fail berturut-turut → pause
                  if (consecutiveChromeFails >= MAX_CHROME_FAILS_BEFORE_PAUSE) {
                    const pauseSec = CHROME_FAIL_PAUSE_MS / 1000;
                    logger.error(
                      `[Circuit Breaker] Chrome gagal ${consecutiveChromeFails}x berturut-turut. ` +
                      `Pause ${pauseSec}s sebelum retry. Cek library dependency di deployment.`
                    );
                    StateService.update({
                      status: 'cooldown',
                      cooldownEndsAt: Date.now() + CHROME_FAIL_PAUSE_MS,
                      action: `⛔ Circuit breaker aktif — Chrome gagal ${consecutiveChromeFails}x. Pause ${pauseSec}s...`,
                    });
                    await new Promise(resolve => setTimeout(resolve, CHROME_FAIL_PAUSE_MS));
                    StateService.update({ status: 'running' });
                    consecutiveChromeFails = 0; // reset setelah pause
                  }

                  break; // keluar dari proxy retry loop — ganti proxy tidak akan membantu
                } else {
                  // ── Error proxy biasa — coba proxy berikutnya ───────────────
                  // Blacklist jika target site yang memblok (jangan re-attempt di sesi lain)
                  if (msg.includes('Anonymous Proxy detected') || msg.includes('ERR_PROXY')) {
                    proxyPool?.blacklistProxy(p.host, p.port);
                  }
                  StateService.update({ proxyRetries: StateService.getState().proxyRetries + 1, step: 0 });
                  logger.warn(`[R${round}·S${i+1}] Proxy ${proxyStr} gagal (${msg.split('\n')[0] ?? 'unknown'}), coba berikutnya...`);
                }
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
              // Delay anti-spam: jangan loop terlalu cepat saat semua proxy gagal
              await new Promise(resolve => setTimeout(resolve, 3000));
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
