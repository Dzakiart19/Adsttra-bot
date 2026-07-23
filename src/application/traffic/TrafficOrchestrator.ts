import { BrowserEngine, BrowserOptions } from '../../domain/interfaces/BrowserEngine';
import { Session } from '../../domain/entities/Session';
import { logger } from '../../infrastructure/logging/logger';
import { Config } from '../../infrastructure/config/config';
import { BehaviorService } from '../../infrastructure/browser/BehaviorService';
import { MetricsService } from '../../infrastructure/monitoring/MetricsService';
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

      // Catatan: reputation check TIDAK dilakukan di sini — sudah dilakukan di main.ts
      // sebelum TrafficOrchestrator dipanggil (skip proxy burnt sebelum buka browser).
      // Melakukan checkIP() lagi di sini hanya membuang kuota ip-api.com (45 req/min)
      // dan berpotensi race condition dengan state yang baru saja di-set main.ts.

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

      // 3. Proxy-block detection: cek apakah target site memblok IP proxy ini
      //
      // Banyak ad network (effectivecpmnetwork.com, dll) mendeteksi proxy di level
      // HTTP dan menampilkan halaman blokir ("Anonymous Proxy detected.", "Access denied", dll)
      // alih-alih konten iklan. Jika tidak dideteksi, bot akan diam di halaman kosong
      // tanpa impression terhitung, dan proxy burnt tidak terdeteksi.
      //
      // Solusi: cek body text setelah navigasi. Jika ada indikasi blokir,
      // lempar ERR_PROXY agar retry logic di main.ts aktif (coba proxy berikutnya).
      {
        try {
          const bodyText: string = await this.engine.evaluate(() => {
            const text = (document.body?.innerText || document.body?.textContent || '').trim();
            return text.substring(0, 600);
          });

          // Pola umum halaman blokir proxy dari berbagai ad network & CDN
          const BLOCK_PATTERNS = [
            /anonymous proxy detected/i,
            /proxy detected/i,
            /vpn detected/i,
            /your ip.*blocked/i,
            /ip.*blocked/i,
            /access denied/i,
            /you have been blocked/i,
            /suspicious activity/i,
            /automated.*traffic/i,
            /bot.*detected/i,
          ];

          const isBlocked = bodyText.length < 500 && BLOCK_PATTERNS.some(re => re.test(bodyText));
          if (isBlocked) {
            const shortText = bodyText.substring(0, 120).replace(/\n/g, ' ');
            logger.warn(`[TrafficOrchestrator] Proxy diblok oleh target site: "${shortText}"`);
            StateService.update({ action: `⚠ Proxy diblok target site — retry proxy lain...` });
            throw new Error(`ERR_PROXY: Target site blocked this proxy IP — "${shortText}"`);
          }

          // Log konfirmasi: berapa karakter yang dimuat (indikasi halaman real vs blokir)
          logger.debug(`[TrafficOrchestrator] Page loaded: ${bodyText.length} chars — proxy OK`);
        } catch (checkErr: any) {
          // Jika error adalah proxy block yang kita lempar sendiri → re-throw
          if (checkErr?.message?.includes('ERR_PROXY')) throw checkErr;
          // Evaluate error lain (page crash, dll) → abaikan, lanjut
          logger.debug('[TrafficOrchestrator] Proxy-block check skipped (evaluate error)', { err: checkErr?.message });
        }
      }

      // 4. Ad Warm-up: tunggu script iklan init + full-page scroll untuk trigger SEMUA iklan
      //
      // KRITIS untuk impression count: Adsterra menggunakan IntersectionObserver —
      // iklan HANYA dicatat saat elemen iklan masuk viewport untuk pertama kali.
      // Dengan 10 ad unit di satu halaman, bot HARUS scroll melewati seluruh halaman
      // agar semua 10 iklan mendapat kesempatan masuk viewport dan fire impression XHR.
      //
      // Alur:
      //   1. Tunggu 3s — beri waktu Adsterra script load & register observer
      //   2. Full-page sweep turun — scroll viewport-by-viewport, pause tiap step
      //      agar IntersectionObserver punya waktu callback & kirim impression
      //   3. Scroll kembali ke atas perlahan — trigger observer kedua kali (beberapa
      //      ad network hitung ulang jika keluar-masuk viewport)
      {
        StateService.update({ action: 'Ad warm-up: menunggu Adsterra script init (3s)...' });
        await this.engine.wait(3000);

        try {
          // Ambil tinggi halaman dan viewport dari browser
          const pageInfo: { scrollHeight: number; viewportHeight: number } = await this.engine.evaluate(() => ({
            scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
            viewportHeight: window.innerHeight,
          }));

          const { scrollHeight, viewportHeight } = pageInfo;
          // Scroll dalam chunk ~60% viewport agar setiap elemen punya overlap antar langkah
          const chunkSize = Math.floor(viewportHeight * 0.6);
          // Estimasi jumlah langkah untuk cover seluruh halaman
          const totalSteps = Math.ceil(scrollHeight / chunkSize);

          logger.debug(`Ad warm-up full-page sweep: pageHeight=${scrollHeight} viewportH=${viewportHeight} steps=${totalSteps} chunkSize=${chunkSize}`);
          StateService.update({ action: `Ad warm-up: full-page sweep ${totalSteps} langkah untuk trigger semua ${10} iklan...` });

          // ── Sweep turun: top → bottom ──────────────────────────────────────────
          for (let step = 0; step < totalSteps; step++) {
            await this.engine.scroll(0, chunkSize);
            // Pause 700–1100ms per langkah — cukup lama untuk IntersectionObserver callback
            const pauseMs = Math.floor(Math.random() * 400) + 700;
            await this.engine.wait(pauseMs);
          }

          // Tahan di bawah halaman 1.5s — iklan paling bawah butuh waktu extra
          await this.engine.wait(1500);

          // ── Sweep naik: bottom → top (lebih lambat, natural) ──────────────────
          const upSteps = Math.ceil(totalSteps * 0.6); // tidak perlu balik 100%, cukup ke tengah
          for (let step = 0; step < upSteps; step++) {
            await this.engine.scroll(0, -chunkSize);
            await this.engine.wait(Math.floor(Math.random() * 300) + 500);
          }

          // Kembali ke posisi atas (scroll to top)
          await this.engine.evaluate(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
          await this.engine.wait(800);

        } catch { /* scroll error (page crash / non-scrollable), abaikan */ }
      }

      // 4. Dwell time di URL target
      // Kurangi waktu yang sudah terpakai (browser init + navigate + warmup) dari durationMs
      // agar total sesi tidak melebihi yang dikonfigurasi.
      // Minimum dwell 1 detik agar kontekstual klik tetap bisa dieksekusi.
      const elapsedBeforeDwell = Date.now() - startTime;
      const dwellMs = Math.max(1000, config.durationMs - elapsedBeforeDwell);

      // Jumlah step disesuaikan durasi: sesi pendek (< 60s) cukup 1 step
      // supaya timer dashboard mencerminkan durasi penuh di URL target.
      const numSteps = dwellMs < 60000 ? 1 : 4;
      const stayWeights = Array.from({ length: numSteps }, () => Math.random() + 0.5);
      const totalWeight = stayWeights.reduce((a, b) => a + b, 0);
      const stayDurations = stayWeights.map(w => Math.floor((w / totalWeight) * dwellMs));

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
