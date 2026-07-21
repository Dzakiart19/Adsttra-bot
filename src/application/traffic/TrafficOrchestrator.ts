import { BrowserEngine, BrowserOptions } from '../../domain/interfaces/BrowserEngine';
import { Session } from '../../domain/entities/Session';
import { logger } from '../../infrastructure/logging/logger';
import { Config } from '../../infrastructure/config/config';
import { BehaviorService } from '../../infrastructure/browser/BehaviorService';
import { MetricsService } from '../../infrastructure/monitoring/MetricsService';
import { ReputationService } from '../../infrastructure/monitoring/ReputationService';
import { StateService } from '../../infrastructure/monitoring/StateService';

export class TrafficOrchestrator {
  private blacklist = [
    'https://www.facebook.com/ppplayermusic',
    'https://instagram.com/ppplayermusic',
  ];

  constructor(private engine: BrowserEngine) {}

  async run(session: Session, options: Partial<BrowserOptions> = {}): Promise<void> {
    const { config } = session;
    const startTime = Date.now();
    logger.info('Starting traffic session', {
      id: config.id, url: config.url, targetDurationMs: config.durationMs
    });

    try {
      const metrics = MetricsService.getInstance();
      metrics.trackSessionStart();

      // Reputation check async (non-blocking)
      ReputationService.checkIP(config.proxy?.server)
        .then(details => {
          if (details) {
            const burnt = details.hosting || details.proxy || details.vpn;
            StateService.update({ proxyBurnt: burnt });
          }
        })
        .catch(() => {});

      const { ReferrerService } = require('../../infrastructure/browser/ReferrerService');
      const referrerService = new ReferrerService(logger);

      StateService.update({ action: 'Membuka browser (stealth mode)...' });
      await this.engine.init({
        userAgent: config.userAgent,
        viewport: config.viewport,
        proxy: config.proxy,
        userDataDir: config.userDataDir,
        headless: options.headless,
        platform: options.platform,
        fingerprintScript: options.fingerprintScript
      });

      // 1. Geolocation Matching
      if (Config.MATCH_GEOLOCATION && config.proxy) {
        try {
          StateService.update({ action: 'Matching geolocation ke IP proxy...' });
          // Ekstrak host dari proxy server (format: "host:port") lalu query langsung
          // ke ip-api.com/{host} agar mendapat geolokasi IP proxy, bukan IP server sendiri
          const proxyHost = config.proxy.server.split(':')[0];
          const geoUrl = proxyHost
            ? `http://ip-api.com/json/${proxyHost}?fields=status,lat,lon,city,country`
            : 'http://ip-api.com/json/?fields=status,lat,lon,city,country';
          const response = await fetch(geoUrl);
          if (response.ok) {
            const data: any = await response.json();
            if (data.status === 'success' && data.lat && data.lon) {
              logger.info('Setting Geolocation to match Proxy', { lat: data.lat, lon: data.lon, city: data.city, country: data.country, proxyHost });
              await this.engine.setGeolocation(data.lat, data.lon);
            }
          }
        } catch (e) {
          logger.debug('Geolocation matching failed, using browser default', { e });
        }
      }

      // 2. Organic Search or Referrer Spoofing
      if (Config.ORGANIC_SEARCH && Config.SEARCH_KEYWORDS.length > 0) {
        const keyword = referrerService.getRandomKeyword(Config.SEARCH_KEYWORDS);
        const { name, url: homepageUrl } = referrerService.getSearchHomepage(Config.SEARCH_ENGINE);

        logger.info(`Simulating Organic Search via ${name}`, { keyword, homepageUrl });
        StateService.update({ action: `Membuka ${name} untuk organic search...`, referrer: homepageUrl });

        await this.engine.navigate(homepageUrl);
        await this.engine.waitForNetworkIdle();
        await this.engine.handleConsentPopups();
        await this.engine.randomDelay(1000, 3000);

        StateService.update({ action: `Mengetik keyword: "${keyword}"` });
        await this.engine.searchKeyword(keyword);
        const searchUrl = await this.engine.evaluate(() => window.location.href);

        if (Config.HUMAN_BEHAVIOR) {
          logger.info('Simulating human-like result scanning...');
          StateService.update({ action: 'Membaca halaman hasil pencarian...' });
          const searchWait = Math.floor(Math.random() * 3000) + 3000;
          const searchStart = Date.now();
          while (Date.now() - searchStart < searchWait) {
            await BehaviorService.simulateRandomAction(this.engine, config.viewport, { intensity: 'low' });
          }
        } else {
          await this.engine.randomDelay(2000, 5000);
        }

        const targetValue = Config.SEARCH_TARGET_VALUE || config.url;
        const pageLimit = Config.SEARCH_PAGES_LIMIT;
        let clicked = false;

        for (let page = 1; page <= pageLimit; page++) {
          StateService.update({ action: `Mencari target di halaman pencarian ${page}/${pageLimit}...` });
          logger.info(`Searching for target link (Page ${page}/${pageLimit})...`);
          clicked = await this.engine.clickSearchResult(targetValue);

          if (clicked) {
            logger.info(`Successfully clicked target on page ${page}!`);
            StateService.update({ action: `Klik hasil pencarian → navigasi ke target` });
            await this.engine.wait(Math.floor(Math.random() * 2000) + 3000);
            try { await this.engine.waitForNetworkIdle(); } catch { /* ok */ }
            break;
          }

          if (page < pageLimit) {
            const movedToNext = await this.engine.clickNextSearchPage();
            if (!movedToNext) break;
            await this.engine.waitForNetworkIdle();
            await this.engine.randomDelay(2000, 4000);
          }
        }

        if (!clicked) {
          logger.warn(`Target not found within ${pageLimit} pages. Navigating directly.`);
          StateService.update({ action: 'Target tidak ditemukan di SERP, navigasi langsung...' });
          await this.engine.setExtraHeaders({ 'Referer': searchUrl });
          await this.engine.navigate(config.url);
        }
      } else {
        const referrer = referrerService.getRandomReferrer(Config.REFERRER_POOL);
        if (referrer) {
          logger.info(`Spoofing Referrer`, { referrer });
          StateService.update({ referrer, action: `Spoofing referrer → navigasi ke target...` });
          await this.engine.setExtraHeaders({ 'Referer': referrer });
        } else {
          StateService.update({ action: 'Navigasi langsung ke target...' });
        }
        await this.engine.navigate(config.url);
      }

      // 3. Ad Warm-up: tunggu script iklan benar-benar initialize
      //
      // KRITIS untuk impression count: Adsterra & ad network lain menggunakan
      // pola deferred initialization — script mereka baru fire impression call
      // setelah 2-6 detik via setTimeout() atau IntersectionObserver.
      // Tanpa ini, bot sudah lanjut tapi impression XHR belum dikirim.
      //
      // Juga scroll untuk trigger below-fold ads yang pakai IntersectionObserver:
      // ad hanya di-fetch dan dicatat saat masuk viewport pertama kali.
      {
        const warmupMs = Math.floor(Math.random() * 3000) + 5000; // 5–8 detik
        StateService.update({ action: `Ad warm-up: menunggu script iklan init (${(warmupMs/1000).toFixed(1)}s)...` });
        logger.debug(`Ad warm-up: ${warmupMs}ms`);
        await this.engine.wait(warmupMs);

        // Scroll bertahap untuk trigger IntersectionObserver (above + below fold)
        try {
          await this.engine.scroll(0, 200);
          await this.engine.wait(700);
          await this.engine.scroll(0, 300);
          await this.engine.wait(800);
          await this.engine.scroll(0, 250);
          await this.engine.wait(600);
          await this.engine.scroll(0, -200); // kembali ke atas sedikit
          await this.engine.wait(500);
        } catch { /* scroll gagal (non-scrollable page), abaikan */ }
      }

      // 4. Dwell time di URL target
      // Jumlah step disesuaikan durasi: sesi pendek (< 60s) cukup 1 step
      // supaya timer dashboard mencerminkan durasi penuh di URL target.
      const numSteps = config.durationMs < 60000 ? 1 : 4;
      const stayWeights = Array.from({ length: numSteps }, () => Math.random() + 0.5);
      const totalWeight = stayWeights.reduce((a, b) => a + b, 0);
      const stayDurations = stayWeights.map(w => Math.floor((w / totalWeight) * config.durationMs));

      logger.debug('Starting navigation loop', {
        numSteps, stayDurations, humanBehavior: Config.HUMAN_BEHAVIOR
      });

      for (let i = 0; i < numSteps; i++) {
        const currentStay = stayDurations[i];
        logger.info(`Step ${i + 1}/${numSteps}: Staying for ${currentStay}ms...`);

        StateService.update({
          step: i + 1,
          totalSteps: numSteps,
          stepStartAt: Date.now(),
          stepDurationMs: currentStay,
          action: `Step ${i + 1}/${numSteps}: browsing halaman (${(currentStay / 1000).toFixed(1)}s)`,
        });

        if (Config.HUMAN_BEHAVIOR) {
          const stepStart = Date.now();
          while (Date.now() - stepStart < currentStay) {
            await BehaviorService.simulateRandomAction(this.engine, config.viewport, { intensity: Config.BEHAVIOR_INTENSITY });
          }
        } else {
          await this.engine.wait(currentStay);
        }

        await this.performContextualClick();
      }

      // Final compensating wait (cover sisa waktu jika ada)
      const remainingTime = config.durationMs - (Date.now() - startTime);
      if (remainingTime > 0) {
        StateService.update({ action: 'Final wait — melengkapi durasi sesi...' });
        await this.engine.wait(remainingTime);
      }

      const actualDuration = Date.now() - startTime;
      metrics.trackSessionEnd(true, actualDuration);
      StateService.update({ step: 0, action: `Sesi selesai ✓ (${(actualDuration / 1000).toFixed(1)}s)` });
      logger.info('Session completed successfully', {
        id: config.id, actualDurationMs: actualDuration, targetDurationMs: config.durationMs
      });
    } catch (error: any) {
      const actualDuration = Date.now() - startTime;
      MetricsService.getInstance().trackSessionEnd(false, actualDuration);
      StateService.update({ step: 0, action: `Sesi gagal: ${error?.message?.split('\n')[0] ?? 'unknown error'}` });
      logger.error('Session execution failed', {
        id: config.id,
        error: error instanceof Error
          ? { message: error.message, name: error.name }
          : String(error)
      });
      throw error; // re-throw agar main.ts bisa trigger proxy retry
    } finally {
      // Grace period: beri waktu 2–3 detik agar XHR/beacon impression iklan
      // yang masih in-flight selesai dikirim sebelum browser ditutup.
      // Tanpa ini, browser close membunuh request yang belum sampai ke server.
      try {
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 1000) + 2000));
      } catch { /* abaikan */ }
      await this.engine.close();
    }
  }

  async runFromJob(jobId: string, data: any): Promise<void> {
    const { FingerprintService } = require('../../infrastructure/browser/FingerprintService');
    const fingerprint = FingerprintService.generate();

    const session = new Session({
      id: jobId,
      url: data.url,
      userAgent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      durationMs: data.durationMinutes * 60000,
      proxy: data.proxy
        ? { server: `${data.proxy.host}:${data.proxy.port}`, username: data.proxy.username, password: data.proxy.password }
        : undefined
    });

    await this.run(session, {
      headless: Config.HEADLESS,
      platform: fingerprint.platform,
      fingerprintScript: FingerprintService.getInjectionScript(fingerprint)
    });
  }

  private async performContextualClick(): Promise<void> {
    StateService.update({ action: 'Memilih link untuk diklik (weighted scoring)...' });

    const clickResult = await this.engine.evaluate((blacklist) => {
      const HIGH_VALUE = ['about', 'product', 'service', 'feature', 'price', 'blog', 'case', 'contact'];
      const LOW_VALUE  = ['login', 'register', 'signin', 'signup', 'terms', 'privacy', 'policy', 'legal'];

      const links = Array.from(document.querySelectorAll('a'))
        .filter(a => {
          const href = a.href;
          return href && !blacklist.some((b: string) => href.includes(b)) && href.startsWith(window.location.origin);
        })
        .map(a => {
          const text = (a.innerText || a.title || '').toLowerCase().trim();
          let score = 10;
          if (HIGH_VALUE.some(k => text.includes(k))) score += 20;
          if (LOW_VALUE.some(k => text.includes(k)))  score -= 5;
          const rect = a.getBoundingClientRect();
          score += Math.min(rect.width * rect.height / 1000, 10);
          return { href: a.href, score, text };
        });

      if (links.length === 0) return null;

      const totalScore = links.reduce((sum, l) => sum + l.score, 0);
      let rand = Math.random() * totalScore;
      for (const link of links) {
        rand -= link.score;
        if (rand <= 0) { window.location.href = link.href; return { href: link.href, text: link.text }; }
      }
      return null;
    }, this.blacklist);

    if (clickResult) {
      StateService.update({ action: `Klik: "${clickResult.text}" → ${clickResult.href}` });
      logger.info(`Contextual click: "${clickResult.text}" → ${clickResult.href}`);
    } else {
      logger.debug('No suitable links for contextual click.');
    }
  }
}
