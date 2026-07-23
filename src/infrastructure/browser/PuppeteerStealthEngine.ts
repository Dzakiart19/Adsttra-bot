import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { BrowserEngine, BrowserOptions } from '../../domain/interfaces/BrowserEngine';
import { logger } from '../logging/logger';

puppeteer.use(StealthPlugin());

// ── Module-level cache untuk Chrome executable path ───────────────────────────
// Nilai: undefined = belum dicari, null = tidak ditemukan, string = path ditemukan.
// Tujuan: cegah execSync() blocking event loop dijalankan setiap sesi (>2600×/hari).
// Dicari SEKALI, lalu seluruh sesi berikutnya pakai hasil cache.
let _cachedChromePath: string | null | undefined = undefined;

export class PuppeteerStealthEngine implements BrowserEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(options: BrowserOptions): Promise<void> {
    const args = [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-position=0,0',
      '--no-first-run',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-default-browser-check',
      // Matikan background network requests agar tidak hang saat proxy dead
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-service-autorun',
      '--password-store=basic',
      '--safebrowsing-disable-auto-update',
      '--use-mock-keychain',
    ];

    // On Linux and Windows, we usually need the sandbox flags or to disable them for stability
    if (process.platform === 'linux' || process.platform === 'win32') {
      args.push('--no-sandbox');
      args.push('--disable-setuid-sandbox');
      args.push('--disable-dev-shm-usage');
      args.push('--disable-accelerated-2d-canvas');
      args.push('--disable-gpu');
    }

    if (options.proxy) {
      args.push(`--proxy-server=${options.proxy.server}`);
    }

    // Beberapa proxy melakukan MITM pada HTTPS dan menyajikan cert mereka sendiri
    // (ERR_CERT_AUTHORITY_INVALID). Kita bypass validasi cert agar sesi tetap jalan.
    args.push('--ignore-certificate-errors');

    // Cari executable Chrome/Chromium yang tersedia
    let executablePath: string | undefined;
    const fs = require('fs');

    // Prioritas 1: PUPPETEER_EXECUTABLE_PATH dari start.sh (paling andal di deployment)
    // start.sh mencari binary nyata dengan `find` dan export env var ini
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
      executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Prioritas 2: scan .puppeteer_cache/ untuk versi apapun (version-agnostic)
    // PENTING: execSync() memblokir event loop Node.js — JANGAN jalankan setiap sesi.
    // Gunakan cache module-level (_cachedChromePath): cari sekali, pakai selamanya.
    if (!executablePath) {
      if (_cachedChromePath === undefined) {
        // Belum pernah dicari — jalankan sekali dan simpan hasilnya
        const cacheDir = process.env.PUPPETEER_CACHE_DIR ||
          require('path').join(__dirname, '..', '..', '..', '.puppeteer_cache');
        try {
          const { execSync } = require('child_process');
          const found = execSync(
            `find "${cacheDir}" -name "chrome-headless-shell" -type f 2>/dev/null | head -1`,
            { encoding: 'utf8' }
          ).trim();
          _cachedChromePath = (found && fs.existsSync(found)) ? found : null;
        } catch (_) {
          _cachedChromePath = null; // tidak ditemukan, cache null agar tidak coba lagi
        }
        if (_cachedChromePath) {
          logger.debug(`[PuppeteerEngine] Chrome cache scan: ditemukan → ${_cachedChromePath}`);
        }
      }
      // Pakai hasil cache (null berarti tidak ditemukan di prioritas 2)
      if (_cachedChromePath) {
        executablePath = _cachedChromePath;
      }
    }

    // Prioritas 3: path legacy ~/.cache dan system chromium
    if (!executablePath) {
      const fallbackPaths = [
        '/home/runner/.cache/puppeteer/chrome-headless-shell/linux-148.0.7778.97/chrome-headless-shell-linux64/chrome-headless-shell',
        '/home/runner/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
      ];
      for (const p of fallbackPaths) {
        if (fs.existsSync(p)) { executablePath = p; break; }
      }
    }

    const launchOptions: any = {
      headless: options.headless === false ? false : 'new',
      args,
      executablePath,
      ignoreDefaultArgs: ['--enable-automation'],
      ignoreHTTPSErrors: true,
      defaultViewport: options.viewport || { width: 1280, height: 720 },
      timeout: 30000,         // max 30s untuk browser launch
      protocolTimeout: 30000, // max 30s untuk DevTools protocol handshake
    };

    if (options.userDataDir) {
      launchOptions.userDataDir = options.userDataDir;
    }

    this.browser = await (puppeteer as any).launch(launchOptions);
    const pages = await this.browser!.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser!.newPage();

    if (options.userAgent) {
      await this.page.setUserAgent(options.userAgent);
      
      // Reinforce Client Hints (Sec-CH-UA)
      const chromeMatch = options.userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch) {
        const majorVersion = chromeMatch[1];
        const isMobile = options.userAgent.includes('Mobile');
        const platform = options.platform === 'MacIntel' ? 'macOS' : 
                         options.platform === 'Win32' ? 'Windows' : 'Linux';

        const extraHeaders: Record<string, string> = {
          'sec-ch-ua': `"Not(A:Brand";v="99", "Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}"`,
          'sec-ch-ua-mobile': isMobile ? '?1' : '?0',
          'sec-ch-ua-platform': `"${platform}"`,
        };

        // Set Accept-Language header sesuai fingerprint negara proxy
        // Penting agar sinyal browser konsisten: navigator.languages === Accept-Language
        if (options.acceptLanguage) {
          extraHeaders['Accept-Language'] = options.acceptLanguage;
        }

        await this.page.setExtraHTTPHeaders(extraHeaders);
      }
    }

    if (options.viewport) {
      await this.page.setViewport(options.viewport);
    }

    if (options.proxy?.username && options.proxy?.password) {
      await this.page.authenticate({
        username: options.proxy.username,
        password: options.proxy.password,
      });
    }

    await this.page.evaluateOnNewDocument(options.fingerprintScript!);

    logger.debug('Puppeteer Stealth initialized with advanced fingerprint', { 
      userAgent: options.userAgent,
      platform: options.platform 
    });
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    // 'load' lebih reliable dari 'networkidle2' untuk ad-heavy sites:
    // Ad network terus-menerus ping tracking server sehingga networkidle2
    // tidak pernah tercapai → 60s timeout → salah diklasifikasikan sebagai
    // proxy error → proxy slot terbuang. Setelah 'load', ad warm-up di
    // TrafficOrchestrator (5-8s + IntersectionObserver scroll) sudah cukup
    // untuk memastikan impression XHR dikirim.
    await this.page.goto(url, { waitUntil: 'load', timeout: 30000 });
  }

  async wait(ms: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    if (!this.page) throw new Error('Engine not initialized');
    return await this.page.evaluate(fn, ...args);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      // Coba mouse.wheel dulu (lebih realistis, terdeteksi sebagai human scroll)
      await (this.page as any).mouse.wheel({ deltaX, deltaY });
    } catch {
      // Fallback ke window.scrollBy — bekerja di semua halaman termasuk non-scrollable SPA
      // Tidak throw, tidak merusak sesi jika halaman memang tidak bisa di-scroll
      try {
        await this.page.evaluate(
          (dx: number, dy: number) => { try { window.scrollBy(dx, dy); } catch { /* halaman tidak scrollable, abaikan */ } },
          deltaX, deltaY
        );
      } catch { /* page mungkin sudah tertutup, abaikan */ }
    }
  }

  async mouseMove(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.mouse.move(x, y, { steps: 5 }); // Use steps for smoother movement
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.mouse.click(x, y);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.setExtraHTTPHeaders(headers);
  }

  async setGeolocation(latitude: number, longitude: number): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    await this.page.setGeolocation({ latitude, longitude, accuracy: 100 });
    
    // Grant geolocation permission for all origins (page.url() is about:blank before navigate)
    const context = this.browser!.defaultBrowserContext();
    await context.overridePermissions('', ['geolocation']);
  }

  async waitForNetworkIdle(): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      await this.page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 });
    } catch (e) {
      // Ignore network idle timeouts, some pages never fully idle
    }
  }

  async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.wait(delay);
  }

  async clickLinkByHref(href: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const link = await this.page.$(`a[href="${href}"]`);
      if (link) {
        // Robust click
        await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
        await this.randomDelay(500, 1500);
        await link.click({ delay: Math.random() * 200 + 100 });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickLinkContainingHref(partialHref: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const links = await this.page.$$('a');
      for (const link of links) {
        const href = await this.page.evaluate(el => el.getAttribute('href'), link);
        if (href && href.includes(partialHref)) {
          // Robust click
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(500, 1500);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickLinkByText(text: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      // Look for links that contain the text
      const links = await this.page.$$('a');
      for (const link of links) {
        const linkText = await this.page.evaluate(el => el.textContent, link);
        if (linkText && linkText.toLowerCase().includes(text.toLowerCase())) {
          // Robust click
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(500, 1500);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async clickNextSearchPage(): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const nextSelectors = [
        'a#pnnext', // Google
        'a.sb_pagN', // Bing
        'a.page-link[aria-label="Next page"]', // Bing alternative
        'button#more-results', // DuckDuckGo
        'a:contains("Next")', // Generic text-based fallback
      ];

      for (const selector of nextSelectors) {
        const nextButton = await this.page.$(selector);
        if (nextButton) {
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), nextButton);
          await this.randomDelay(500, 1500);
          await nextButton.click({ delay: Math.random() * 200 + 100 });
          await this.waitForNetworkIdle();
          return true;
        }
      }

      // Special case for DuckDuckGo "More Results" button
      if (await this.page.$('#more-results')) {
        await this.page.click('#more-results');
        await this.randomDelay(1000, 2000);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  async clickSearchResult(pattern: string): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    try {
      const links = await this.page.$$('a');
      const patternLower = pattern.toLowerCase();

      for (const link of links) {
        const href = await this.page.evaluate(el => el.getAttribute('href'), link);
        const text = await this.page.evaluate(el => el.textContent, link);
        
        // Skip common search engine internal links
        if (text && (text.toLowerCase().includes('similar') || text.toLowerCase().includes('cached'))) continue;

        // Strategy 1: Direct href match
        if (href && href.toLowerCase().includes(patternLower)) {
          // Special case for search engine redirect URLs (e.g., google.com/url?q=...)
          const isRedirect = href.includes('/url?') || href.includes('bing.com/ck/a?') || href.includes('duckduckgo.com/l/?');
          if (isRedirect) {
            // Check if the pattern is in the query params or the full encoded URL
            try {
              const urlObj = new URL(href, this.page.url());
              const target = urlObj.searchParams.get('q') || urlObj.searchParams.get('url') || urlObj.searchParams.get('uddg');
              if (target && target.toLowerCase().includes(patternLower)) {
                logger.info(`Heuristic: Found target in redirect URL: ${target}`);
              } else if (!href.toLowerCase().includes(patternLower)) {
                continue; // Not a match in the redirect target
              }
            } catch (e) {
              // URL parsing failed, but if href still contains pattern, we proceed
              if (!href.toLowerCase().includes(patternLower)) continue;
            }
          }

          logger.info(`Clicking result by href: ${href}`);
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(800, 2000);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }

        // Strategy 2: Text content match
        if (text && text.toLowerCase().includes(patternLower)) {
          logger.info(`Clicking result by text: ${text.trim()}`);
          await this.page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), link);
          await this.randomDelay(800, 2000);
          await link.click({ delay: Math.random() * 200 + 100 });
          return true;
        }
      }

      return false;
    } catch (e) {
      logger.error(`Error in clickSearchResult: ${e}`);
      return false;
    }
  }

  async searchKeyword(keyword: string): Promise<void> {
    if (!this.page) throw new Error('Engine not initialized');
    
    const searchInputSelectors = [
      'input[name="q"]', // Google, Bing
      'textarea[name="q"]', // Google modern
      '#search_form_input_homepage', // DuckDuckGo homepage
      '#search_form_input', // DuckDuckGo results
      'input[type="text"]', // Generic fallback
    ];

    let inputSet = false;
    for (const selector of searchInputSelectors) {
      try {
        const input = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (input) {
          logger.debug(`Found search input with selector: ${selector}`);
          
          // Clear input first
          await input.click();
          await this.page.keyboard.down('Meta'); // Mac CMD
          await this.page.keyboard.press('a');
          await this.page.keyboard.up('Meta');
          await this.page.keyboard.press('Backspace');
          
          // Fallback for non-mac or failed CMD+A
          const currentVal = await input.evaluate((el: any) => el.value);
          if (currentVal) {
             await this.page.keyboard.down('Control');
             await this.page.keyboard.press('a');
             await this.page.keyboard.up('Control');
             await this.page.keyboard.press('Backspace');
          }

          // Type like a human
          await input.type(keyword, { delay: Math.random() * 100 + 50 });
          await this.randomDelay(500, 1200);
          
          // Press Enter and wait for navigation
          const navPromise = this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
            logger.debug('Search navigation timeout or already navigated');
          });
          await this.page.keyboard.press('Enter');
          await navPromise;
          
          await this.waitForNetworkIdle();
          inputSet = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!inputSet) {
      throw new Error(`Search input not found with any selector for keyword: ${keyword}`);
    }
  }

  async handleConsentPopups(): Promise<boolean> {
    if (!this.page) throw new Error('Engine not initialized');
    
    logger.debug('Checking for consent popups...');
    
    const consentSelectors = [
      // Google
      'button[aria-label="Accept all"]',
      'button[aria-label="I agree"]',
      '#L2AGLb', // Google "Accept all" ID
      'button:contains("Accept all")',
      // Bing
      '#bnp_btn_accept',
      'button#bnp_btn_accept',
      '#adlt_set_save',
      // Generic XPath for buttons containing specific text
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "accept all")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "i agree")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "agree")]',
      '//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "accept cookies")]'
    ];

    try {
      // Short delay to allow popup to appear
      await new Promise(resolve => setTimeout(resolve, 2000));

      for (const selector of consentSelectors) {
        let element;
        if (selector.startsWith('//')) {
          const handles = await this.page.$$(`::-p-xpath(${selector})`);
          if (handles.length > 0) element = handles[0];
        } else if (selector.includes(':contains')) {
          const text = selector.match(/:contains\("(.+)"\)/)?.[1];
          if (text) {
             const handles = await this.page.$$(`::-p-xpath(//button[contains(., "${text}")])`);
             if (handles.length > 0) element = handles[0];
          }
        } else {
          element = await this.page.$(selector);
        }

        if (element) {
          const isVisible = await element.evaluate((el: any) => {
            const style = window.getComputedStyle(el);
            return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
          });

          if (isVisible) {
            logger.info('Consent popup detected, attempting to clear...', { selector });
            await (element as any).click();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for it to close
            return true;
          }
        }
      }
      
      logger.debug('No active consent popups detected.');
      return false;
    } catch (error) {
      logger.debug('Error while checking for consent popups', { error: (error as Error).message });
      return false;
    }
  }
}
