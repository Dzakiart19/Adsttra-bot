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

      StateService.update({ action: '🚀 Meluncurkan browser stealth mode...' });
      await this.engine.init({
        userAgent: config.userAgent,
        viewport: config.viewport,
        proxy: config.proxy,
        userDataDir: config.userDataDir,
        headless: options.headless,
        platform: options.platform,
        fingerprintScript: options.fingerprintScript,
        acceptLanguage: options.acceptLanguage,
      });

      // 1. Geolocation Matching
      if (Config.MATCH_GEOLOCATION && config.proxy) {
        try {
          StateService.update({ action: '🌍 Mencocokkan lokasi GPS dengan IP proxy...' });
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
        StateService.update({ action: `🌐 Membuka ${name}...`, referrer: homepageUrl });

        await this.engine.navigate(homepageUrl);
        StateService.update({ action: `✅ ${name} berhasil dimuat — menunggu halaman siap...` });
        await this.engine.waitForNetworkIdle();
        await this.engine.handleConsentPopups();
        await this.engine.randomDelay(1000, 3000);

        StateService.update({ action: `⌨️ Mengetik keyword: "${keyword}"` });
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
          StateService.update({ action: `🔍 Mencari target di halaman SERP ${page}/${pageLimit}...` });
          logger.info(`Searching for target link (Page ${page}/${pageLimit})...`);
          clicked = await this.engine.clickSearchResult(targetValue);

          if (clicked) {
            logger.info(`Successfully clicked target on page ${page}!`);
            StateService.update({ action: `🖱️ Mengklik hasil pencarian → menuju target...` });
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
          StateService.update({ action: '⚠️ Target tidak ditemukan di SERP — navigasi langsung...' });
          await this.engine.setExtraHeaders({ 'Referer': searchUrl });
          StateService.update({ action: `🌐 Membuka halaman: ${config.url}` });
          await this.engine.navigate(config.url);
          StateService.update({ action: `✅ Halaman target berhasil dimuat` });
        }
      } else {
        const referrer = referrerService.getRandomReferrer(Config.REFERRER_POOL);
        if (referrer) {
          logger.info(`Spoofing Referrer`, { referrer });
          StateService.update({ referrer, action: `🔗 Menyiapkan referrer: ${referrer}` });
          await this.engine.setExtraHeaders({ 'Referer': referrer });
        }
        StateService.update({ action: `🌐 Membuka halaman: ${config.url}` });
        await this.engine.navigate(config.url);
        StateService.update({ action: `✅ Halaman target berhasil dimuat` });
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
            StateService.update({ action: `🚫 Proxy diblok oleh target site — ganti proxy...` });
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
        StateService.update({ action: '⏳ Menunggu script iklan selesai load (3s)...' });
        await this.engine.wait(3000);

        try {
          const pageInfo: { scrollHeight: number; viewportHeight: number } = await this.engine.evaluate(() => ({
            scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
            viewportHeight: window.innerHeight,
          }));

          const { scrollHeight, viewportHeight } = pageInfo;
          const chunkSize = Math.floor(viewportHeight * 0.6);
          const totalSteps = Math.ceil(scrollHeight / chunkSize);

          logger.debug(`Ad warm-up full-page sweep: pageHeight=${scrollHeight} viewportH=${viewportHeight} steps=${totalSteps} chunkSize=${chunkSize}`);
          StateService.update({ action: `📺 Memulai ad warm-up — halaman ${scrollHeight}px, total ${totalSteps} langkah scroll` });
          await this.engine.wait(400);

          // ── Sweep turun: top → bottom ──────────────────────────────────────────
          for (let step = 0; step < totalSteps; step++) {
            StateService.update({ action: `📺 Ad warm-up ↓ step ${step + 1}/${totalSteps} — memicu IntersectionObserver iklan...` });
            await this.engine.scroll(0, chunkSize);
            const pauseMs = Math.floor(Math.random() * 400) + 700;
            await this.engine.wait(pauseMs);
          }

          StateService.update({ action: '📺 Menahan posisi bawah — menunggu iklan terbawah load...' });
          await this.engine.wait(1500);

          // ── Sweep naik: bottom → top ──────────────────────────────────────────
          const upSteps = Math.ceil(totalSteps * 0.6);
          for (let step = 0; step < upSteps; step++) {
            StateService.update({ action: `📺 Ad warm-up ↑ kembali ke atas (${step + 1}/${upSteps})` });
            await this.engine.scroll(0, -chunkSize);
            await this.engine.wait(Math.floor(Math.random() * 300) + 500);
          }

          StateService.update({ action: '✅ Ad warm-up selesai — semua iklan telah di-trigger' });
          await this.engine.evaluate(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
          await this.engine.wait(800);

        } catch { /* scroll error (page crash / non-scrollable), abaikan */ }
      }

      // 5. Klik drama card (real DOM click) → trigger Direct Link Adsterra + navigate ke watch.html
      //
      // KRITIS — mengapa real DOM click (bukan window.location.href):
      //   ads-adsterra.js memasang listener:
      //     document.addEventListener("click", openOnce, true)
      //   Direct Link Adsterra HANYA fire saat ada real click event yang bubble ke document.
      //   Jika kita pakai window.location.href = '...' (assignment biasa), TIDAK ada click
      //   event → Direct Link tidak pernah terpicu → kehilangan 1 format iklan CPM tinggi.
      //
      // Dengan engine.click(x, y) → page.mouse.click() → real MouseEvent di DOM →
      //   capturing listener di document AKAN menerima event → Direct Link fire (buka tab baru).
      //   Sekaligus browser follow href anchor → navigate ke watch.html.
      //
      // Watch page memiliki 4 banner slot Adsterra (vs 3 di homepage) — lebih banyak impression.
      const watchUrl = await this.navigateToDramaWatch();

      // 6. Watch page ad warm-up: trigger 4 banner slot Adsterra via IntersectionObserver
      if (watchUrl) {
        StateService.update({ action: '⏳ Watch page: menunggu script iklan init (2s)...' });
        await this.engine.wait(2000);
        await this.watchPageAdWarmup();
      }

      // 7. Dwell time sisa di halaman aktif (watch page, atau homepage jika navigasi gagal)
      const elapsedBeforeDwell = Date.now() - startTime;
      const dwellMs = Math.max(1000, config.durationMs - elapsedBeforeDwell);
      const page = watchUrl ? 'watch page' : 'homepage';

      logger.info(`Dwell ${(dwellMs / 1000).toFixed(1)}s on ${page}`);
      StateService.update({
        step: 1, totalSteps: 1,
        stepStartAt: Date.now(), stepDurationMs: dwellMs,
        action: `Browsing ${page} (${(dwellMs / 1000).toFixed(1)}s)`,
      });

      if (Config.HUMAN_BEHAVIOR) {
        const dwellStart = Date.now();
        while (Date.now() - dwellStart < dwellMs) {
          await BehaviorService.simulateRandomAction(this.engine, config.viewport, { intensity: Config.BEHAVIOR_INTENSITY });
        }
      } else {
        await this.engine.wait(dwellMs);
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
      // PENTING: wrap close() dalam try/catch agar error dari close() (misalnya engine
      // belum selesai init() saat throw terjadi) tidak menimpa/menyembunyikan error asli
      // yang sedang di-propagate dari catch block di atas.
      try {
        await this.engine.close();
      } catch (closeErr: any) {
        logger.debug('[TrafficOrchestrator] engine.close() error (diabaikan)', { err: closeErr?.message });
      }
    }
  }

  async runFromJob(jobId: string, data: any): Promise<void> {
    const { FingerprintService } = require('../../infrastructure/browser/FingerprintService');
    // data.proxy.country tersedia jika producer menyertakannya (distributed mode)
    const country: string | undefined = data.proxy?.country;
    const fingerprint = FingerprintService.generate(country);

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
      fingerprintScript: FingerprintService.getInjectionScript(fingerprint),
      acceptLanguage: fingerprint.acceptLanguage,
    });
  }

  /**
   * Cari drama card di halaman saat ini, scroll ke viewport, lalu klik dengan
   * engine.click() → page.mouse.click() → real MouseEvent → trigger Direct Link Adsterra.
   * Setelah klik, tunggu navigasi ke /watch.html selesai.
   *
   * Mengapa pendekatan ini:
   *   - ads-adsterra.js memasang: document.addEventListener("click", openOnce, true)
   *   - Direct Link HANYA fire jika ada real DOM click event di capturing phase
   *   - window.location.href assignment TIDAK mengirim click event → Direct Link mati
   *   - engine.click(x, y) → page.mouse.click() → real MouseEvent → Direct Link buka tab baru
   */
  private async navigateToDramaWatch(): Promise<string | null> {
    try {
      // Step 1: Scroll sedikit ke bawah agar drama card sudah masuk viewport
      //         (card ada di bawah hero & banner iklan)
      const firstCardPos: { y: number } | null = await this.engine.evaluate(() => {
        const link = document.querySelector('a[href*="watch.html"]') as HTMLAnchorElement | null;
        if (!link) return null;
        link.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { y: window.scrollY };
      });

      if (firstCardPos === null) {
        logger.debug('[TrafficOrchestrator] Tidak ada watch.html link — skip drama navigation');
        return null;
      }
      await this.engine.wait(700);

      // Step 2: Ambil href + koordinat tengah card yang visible di viewport
      const cardInfo: { href: string; x: number; y: number } | null = await this.engine.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="watch.html"]')) as HTMLAnchorElement[];
        const inViewport = links.filter(a => {
          const r = a.getBoundingClientRect();
          return r.width > 30 && r.height > 30 && r.top >= 0 && r.bottom <= window.innerHeight;
        });
        // Pilih acak dari max 10 yang visible
        const pool = inViewport.length ? inViewport : links.slice(0, 10);
        if (!pool.length) return null;
        const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 10))];
        const rect = pick.getBoundingClientRect();
        return {
          href: pick.href,
          x: Math.round(rect.left + rect.width  * (0.3 + Math.random() * 0.4)),
          y: Math.round(rect.top  + rect.height * (0.3 + Math.random() * 0.4)),
        };
      });

      if (!cardInfo) {
        logger.debug('[TrafficOrchestrator] Tidak ada card visible di viewport — skip');
        return null;
      }

      StateService.update({ action: `🎬 Klik drama card → trigger Direct Link + navigate watch...` });
      logger.info(`[TrafficOrchestrator] Drama card click @ (${cardInfo.x}, ${cardInfo.y}) → ${cardInfo.href}`);

      // Step 3: Gerakkan mouse ke arah card (human-like), lalu klik
      await this.engine.mouseMove(cardInfo.x, cardInfo.y);
      await this.engine.wait(150 + Math.floor(Math.random() * 200));

      // engine.click() → page.mouse.click() → real MouseEvent → Direct Link FIRE ✓
      // Browser juga follow href anchor → navigasi ke watch.html dimulai
      try {
        await this.engine.click(cardInfo.x, cardInfo.y);
      } catch {
        // click() bisa throw jika halaman langsung navigate; itu normal
      }

      // Step 4: Tunggu watch page selesai load
      StateService.update({ action: '🌐 Menunggu watch page load...' });
      try {
        await this.engine.waitForNetworkIdle();
      } catch {
        // waitForNetworkIdle timeout → lanjut saja, halaman mungkin sudah cukup loaded
      }
      await this.engine.wait(500);

      // Verifikasi: cek apakah halaman sekarang adalah watch.html
      const currentUrl: string = await this.engine.evaluate(() => window.location.href);
      if (!currentUrl.includes('watch.html')) {
        // Fallback: navigate manual jika entah bagaimana tidak ter-navigasi
        logger.debug(`[TrafficOrchestrator] Tidak landing di watch.html (${currentUrl}), navigate manual`);
        await this.engine.navigate(cardInfo.href);
        await this.engine.wait(500);
      }

      const finalUrl: string = await this.engine.evaluate(() => window.location.href);
      const dramaId = finalUrl.match(/id=([^&]+)/)?.[1] ?? '?';
      StateService.update({ action: `✅ Watch page termuat — drama ${dramaId}` });
      logger.info(`[TrafficOrchestrator] Watch page OK: ${finalUrl}`);
      return finalUrl;

    } catch (e: any) {
      logger.debug(`[TrafficOrchestrator] navigateToDramaWatch error (non-fatal): ${e?.message}`);
      return null;
    }
  }

  /**
   * Ad warm-up di watch page: scroll seluruh halaman agar semua 4 banner slot Adsterra
   * masuk viewport dan IntersectionObserver mereka mengirim impression request.
   *
   * Watch page banner layout:
   *   - 468×60  desktop  (data-ad-key fd59d...)
   *   - 320×50  mobile   (data-ad-key e1d15...)
   *   - + 2 slot tambahan di bawah episode list
   *
   * Lebih cepat dari homepage warm-up (hemat durasi sesi), pakai chunk lebih besar.
   */
  private async watchPageAdWarmup(): Promise<void> {
    try {
      const pageInfo: { scrollHeight: number; viewportHeight: number } = await this.engine.evaluate(() => ({
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        viewportHeight: window.innerHeight,
      }));

      const { scrollHeight, viewportHeight } = pageInfo;
      const chunkSize = Math.floor(viewportHeight * 0.7);
      // Max 10 step — cukup untuk semua banner di watch page
      const totalSteps = Math.min(Math.ceil(scrollHeight / chunkSize), 10);

      logger.debug(`Watch ad warm-up: height=${scrollHeight}px steps=${totalSteps}`);
      StateService.update({ action: `📺 Watch warm-up — ${totalSteps} langkah, 4 banner slot Adsterra...` });
      await this.engine.wait(300);

      // Sweep turun: trigger 4 banner slot (hidden by lazy loading)
      for (let step = 0; step < totalSteps; step++) {
        StateService.update({ action: `📺 Watch warm-up ↓ ${step + 1}/${totalSteps}` });
        await this.engine.scroll(0, chunkSize);
        await this.engine.wait(Math.floor(Math.random() * 300) + 500);
      }
      await this.engine.wait(800);

      // Sweep naik sebagian (trigger kembali observer yang sudah visible)
      const upSteps = Math.ceil(totalSteps * 0.4);
      for (let step = 0; step < upSteps; step++) {
        await this.engine.scroll(0, -chunkSize);
        await this.engine.wait(Math.floor(Math.random() * 200) + 300);
      }

      StateService.update({ action: '✅ Watch warm-up selesai — 4 banner terindeks' });
    } catch {
      // Scroll error → abaikan, lanjut ke dwell
    }
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
