import { UserAgentService } from './UserAgentService';

export interface Fingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  platform: string;
  languages: string[];
  acceptLanguage: string;       // formatted Accept-Language header value
  timezone: string;             // IANA timezone, e.g. "America/New_York"
  timezoneOffset: number;       // return value of Date.prototype.getTimezoneOffset()
  connectionType: 'wifi' | '4g'; // navigator.connection.type
  webgl: {
    vendor: string;
    renderer: string;
  };
}

export class FingerprintService {
  private static GPU_PROFILES = [
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, Radeon(TM) RX 580 Series Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0)' },
    { vendor: 'Apple Inc.', renderer: 'Apple M1' },
    { vendor: 'Apple Inc.', renderer: 'Apple M2' },
    { vendor: 'Intel Inc.', renderer: 'Intel(R) Iris(TM) Plus Graphics 640' },
    { vendor: 'Intel Inc.', renderer: 'Intel(R) Iris(R) Xe Graphics' },
  ];

  // ── Resolusi layar desktop yang paling umum (data StatCounter 2025) ─────────
  private static SCREEN_RESOLUTIONS = [
    { weight: 25, w: 1920, h: 1080 },  // #1 — paling umum
    { weight: 18, w: 1366, h: 768  },  // #2 — laptop budget
    { weight: 12, w: 1440, h: 900  },  // #3 — MacBook Air
    { weight: 10, w: 1536, h: 864  },  // #4 — Surface/laptop scaling
    { weight:  8, w: 1280, h: 800  },  // #5 — MacBook Pro lama
    { weight:  7, w: 1280, h: 720  },  // #6
    { weight:  6, w: 1600, h: 900  },  // #7
    { weight:  5, w: 2560, h: 1440 },  // #8 — 2K monitor
    { weight:  4, w: 1680, h: 1050 },  // #9
    { weight:  3, w: 1920, h: 1200 },  // #10 — widescreen
    { weight:  2, w: 2560, h: 1600 },  // #11 — MacBook Pro 16"
  ];

  // ── Mapping country → timezone IANA + getTimezoneOffset() ───────────────────
  // offset = return value of Date.prototype.getTimezoneOffset():
  //   UTC-x → offset = x*60 (positif), UTC+x → offset = -x*60 (negatif)
  // Nilai berdasarkan Juli 2026 (DST aktif di belahan utara).
  private static COUNTRY_TIMEZONES: Record<string, Array<{ tz: string; offset: number }>> = {
    US: [
      { tz: 'America/New_York',    offset: 240  }, // EDT UTC-4 (~40% users)
      { tz: 'America/Chicago',     offset: 300  }, // CDT UTC-5 (~25%)
      { tz: 'America/Denver',      offset: 360  }, // MDT UTC-6 (~7%)
      { tz: 'America/Los_Angeles', offset: 420  }, // PDT UTC-7 (~28%)
    ],
    GB: [{ tz: 'Europe/London',      offset: -60  }], // BST UTC+1
    CA: [
      { tz: 'America/Toronto',     offset: 240  }, // EDT
      { tz: 'America/Vancouver',   offset: 420  }, // PDT
    ],
    AU: [
      { tz: 'Australia/Sydney',    offset: -600 }, // AEST UTC+10 (winter, no DST)
      { tz: 'Australia/Perth',     offset: -480 }, // AWST UTC+8
    ],
    NZ: [{ tz: 'Pacific/Auckland',   offset: -720 }], // NZST UTC+12 (winter)
    IE: [{ tz: 'Europe/Dublin',      offset: -60  }], // IST UTC+1
    DE: [{ tz: 'Europe/Berlin',      offset: -120 }], // CEST UTC+2
    FR: [{ tz: 'Europe/Paris',       offset: -120 }], // CEST UTC+2
    NL: [{ tz: 'Europe/Amsterdam',   offset: -120 }], // CEST UTC+2
    SE: [{ tz: 'Europe/Stockholm',   offset: -120 }], // CEST UTC+2
    NO: [{ tz: 'Europe/Oslo',        offset: -120 }], // CEST UTC+2
    DK: [{ tz: 'Europe/Copenhagen',  offset: -120 }], // CEST UTC+2
    FI: [{ tz: 'Europe/Helsinki',    offset: -180 }], // EEST UTC+3
    AT: [{ tz: 'Europe/Vienna',      offset: -120 }], // CEST UTC+2
    CH: [{ tz: 'Europe/Zurich',      offset: -120 }], // CEST UTC+2
    BE: [{ tz: 'Europe/Brussels',    offset: -120 }], // CEST UTC+2
    JP: [{ tz: 'Asia/Tokyo',         offset: -540 }], // JST UTC+9 (no DST)
    KR: [{ tz: 'Asia/Seoul',         offset: -540 }], // KST UTC+9 (no DST)
    SG: [{ tz: 'Asia/Singapore',     offset: -480 }], // SGT UTC+8 (no DST)
  };

  // ── Mapping country → navigator.languages ────────────────────────────────────
  private static COUNTRY_LANGUAGES: Record<string, string[]> = {
    // English-only Tier 1
    US: ['en-US', 'en'],
    GB: ['en-GB', 'en', 'en-US'],
    AU: ['en-AU', 'en', 'en-US'],
    NZ: ['en-NZ', 'en', 'en-US'],
    IE: ['en-IE', 'en', 'en-US'],
    SG: ['en-SG', 'en', 'en-US'],
    // Bilingual
    CA: ['en-CA', 'en', 'fr-CA', 'fr'],
    BE: ['nl-BE', 'nl', 'fr-BE', 'fr', 'en-US', 'en'],
    CH: ['de-CH', 'de', 'fr-CH', 'fr', 'en-US', 'en'],
    // Western Europe
    DE: ['de-DE', 'de', 'en-US', 'en'],
    AT: ['de-AT', 'de', 'en-US', 'en'],
    FR: ['fr-FR', 'fr', 'en-US', 'en'],
    NL: ['nl-NL', 'nl', 'en-US', 'en'],
    SE: ['sv-SE', 'sv', 'en-US', 'en'],
    NO: ['nb-NO', 'nb', 'en-US', 'en'],
    DK: ['da-DK', 'da', 'en-US', 'en'],
    FI: ['fi-FI', 'fi', 'en-US', 'en'],
    // Asia Pacific
    JP: ['ja-JP', 'ja', 'en-US', 'en'],
    KR: ['ko-KR', 'ko', 'en-US', 'en'],
  };

  /**
   * Generate a randomized, consistent browser fingerprint.
   *
   * @param country  ISO 3166-1 alpha-2 (e.g. "US", "DE") from proxy country tag.
   *                 Used to set realistic navigator.languages + Accept-Language.
   */
  static generate(country?: string): Fingerprint {
    // ── Platform: SELALU desktop Windows atau Mac — JANGAN pakai process.platform ──
    // Replit berjalan di Linux. Menggunakan process.platform akan menghasilkan
    // UA Linux (X11; Linux x86_64) yang aneh bagi pengiklan. Linux desktop hanya
    // ~2% pasar global — jauh kurang bernilai dari Windows (~75%) atau Mac (~15%).
    // Distribusi target: 70% Windows, 30% Mac — sesuai statistik desktop 2025.
    const useWindows = Math.random() < 0.70;
    const targetPlatform = useWindows ? 'win32' : 'darwin';

    const { ua } = UserAgentService.getRandomUA('most-common', targetPlatform);

    // Resolve navigator.platform berdasarkan UA aktual (bukan platform OS server)
    let navPlatform = 'Win32';
    if (ua.includes('Macintosh') || ua.includes('Mac OS X')) navPlatform = 'MacIntel';
    // Fallback jika UA file berisi Linux (tidak ideal tapi tetap konsisten)
    if (ua.includes('X11; Linux') || ua.includes('Linux x86_64')) navPlatform = 'Linux x86_64';

    // ── GPU: pilih berdasarkan platform yang terdeteksi dari UA ──────────────
    let gpuPool = this.GPU_PROFILES;
    if (navPlatform === 'MacIntel') {
      gpuPool = this.GPU_PROFILES.filter(p => p.vendor.includes('Apple') || p.vendor.includes('Intel'));
    } else if (navPlatform === 'Win32') {
      gpuPool = this.GPU_PROFILES.filter(p =>
        p.vendor.includes('Google') || p.vendor.includes('Intel Inc')
      );
    }
    const webgl = gpuPool[Math.floor(Math.random() * gpuPool.length)];

    // ── Resolusi: weighted random berdasarkan distribusi StatCounter ─────────
    const viewport = this.pickViewport();

    // ── Language: sesuaikan ke negara proxy ──────────────────────────────────
    const languages = this.getLanguagesForCountry(country);
    const acceptLanguage = this.buildAcceptLanguage(languages);

    // ── Timezone: sesuaikan ke negara proxy ──────────────────────────────────
    // Mismatch antara IP negara dan timezone browser adalah sinyal bot yang
    // paling mudah dideteksi ad network — harus selalu konsisten.
    const { tz: timezone, offset: timezoneOffset } = this.pickTimezone(country);

    // ── Connection: desktop selalu wifi (premium signal untuk CPM) ────────────
    // 85% wifi (desktop/laptop), 15% 4g (laptop dengan hotspot)
    const connectionType: 'wifi' | '4g' = Math.random() < 0.85 ? 'wifi' : '4g';

    // ── Hardware: distribusi realistis ────────────────────────────────────────
    const hardwareConcurrency = [4, 8, 8, 8, 12, 16][Math.floor(Math.random() * 6)];
    const deviceMemory = [8, 8, 16, 16][Math.floor(Math.random() * 4)];

    return {
      userAgent: ua,
      viewport,
      deviceScaleFactor: navPlatform === 'MacIntel' ? 2 : 1,
      hardwareConcurrency,
      deviceMemory,
      platform: navPlatform,
      languages,
      acceptLanguage,
      timezone,
      timezoneOffset,
      connectionType,
      webgl,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private static pickViewport(): { width: number; height: number } {
    const totalWeight = this.SCREEN_RESOLUTIONS.reduce((s, r) => s + r.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const res of this.SCREEN_RESOLUTIONS) {
      rand -= res.weight;
      if (rand <= 0) {
        // Sedikit variasi ±8px agar fingerprint tidak identik
        return {
          width:  res.w + Math.floor(Math.random() * 16) - 8,
          height: res.h + Math.floor(Math.random() * 16) - 8,
        };
      }
    }
    return { width: 1920, height: 1080 };
  }

  private static getLanguagesForCountry(country?: string): string[] {
    if (country && this.COUNTRY_LANGUAGES[country]) {
      return this.COUNTRY_LANGUAGES[country];
    }
    // Default ke en-US untuk country unknown (lebih baik daripada bahasa salah)
    return ['en-US', 'en'];
  }

  /**
   * Ubah array bahasa menjadi header Accept-Language RFC 7231:
   *   ['de-DE', 'de', 'en-US', 'en']  →  "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7"
   */
  private static buildAcceptLanguage(languages: string[]): string {
    return languages.map((lang, i) => {
      if (i === 0) return lang;
      const q = Math.max(0.1, 1 - i * 0.1).toFixed(1);
      return `${lang};q=${q}`;
    }).join(',');
  }

  private static pickTimezone(country?: string): { tz: string; offset: number } {
    const pool = (country && this.COUNTRY_TIMEZONES[country]) ?? null;
    if (pool && pool.length > 0) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    // Default ke US Eastern jika negara tidak dikenal
    return { tz: 'America/New_York', offset: 240 };
  }

  // ── Injection script ────────────────────────────────────────────────────────

  static getInjectionScript(fingerprint: Fingerprint): string {
    return `
      (() => {
        // --- Utils ---
        const overwriteProperty = (obj, prop, value) => {
          try {
            Object.defineProperty(obj, prop, {
              get: () => value,
              set: () => {},
              configurable: true,
              enumerable: true
            });
          } catch (e) {}
        };

        const makeNative = (fn, name) => {
          const fnName = name || fn.name;
          const wrapper = {
            [fnName]: function() { return fn.apply(this, arguments); }
          }[fnName];
          
          const toString = () => \`function \${fnName}() { [native code] }\`;
          Object.defineProperty(wrapper, 'toString', {
            value: toString,
            configurable: true,
            enumerable: false,
            writable: true
          });
          return wrapper;
        };

        // --- Hardware & Platform Spoofing ---
        overwriteProperty(navigator, 'hardwareConcurrency', ${fingerprint.hardwareConcurrency});
        overwriteProperty(navigator, 'deviceMemory', ${fingerprint.deviceMemory});
        overwriteProperty(navigator, 'platform', '${fingerprint.platform}');
        overwriteProperty(navigator, 'userAgent', '${fingerprint.userAgent}');
        overwriteProperty(navigator, 'appVersion', '${fingerprint.userAgent.replace('Mozilla/', '')}');
        overwriteProperty(navigator, 'languages', ${JSON.stringify(fingerprint.languages)});
        overwriteProperty(navigator, 'language', '${fingerprint.languages[0]}');

        // --- Viewport & Screen Consistency ---
        const screenWidth = ${fingerprint.viewport.width};
        const screenHeight = ${fingerprint.viewport.height};
        overwriteProperty(screen, 'width', screenWidth);
        overwriteProperty(screen, 'height', screenHeight);
        overwriteProperty(screen, 'availWidth', screenWidth);
        overwriteProperty(screen, 'availHeight', screenHeight - 40);
        overwriteProperty(window, 'innerWidth', screenWidth);
        overwriteProperty(window, 'innerHeight', screenHeight - 80);
        overwriteProperty(window, 'outerWidth', screenWidth);
        overwriteProperty(window, 'outerHeight', screenHeight);
        overwriteProperty(window, 'devicePixelRatio', ${fingerprint.deviceScaleFactor});

        // --- Plugins & MimeTypes Spoofing ---
        const mockPlugins = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
        ];

        const pluginList = mockPlugins.map(p => {
          const plugin = Object.create(Plugin.prototype);
          overwriteProperty(plugin, 'name', p.name);
          overwriteProperty(plugin, 'filename', p.filename);
          overwriteProperty(plugin, 'description', p.description);
          overwriteProperty(plugin, 'length', 0);
          return plugin;
        });

        Object.setPrototypeOf(pluginList, PluginArray.prototype);
        overwriteProperty(navigator, 'plugins', pluginList);
        overwriteProperty(navigator, 'mimeTypes', Object.create(MimeTypeArray.prototype));

        // --- WebGL Randomization ---
        const maskWebGL = (proto) => {
          if (!proto) return;
          const getParameter = proto.getParameter;
          proto.getParameter = makeNative(function(parameter) {
            // UNMASKED_VENDOR_WEBGL
            if (parameter === 37445) return '${fingerprint.webgl.vendor}';
            // UNMASKED_RENDERER_WEBGL
            if (parameter === 37446) return '${fingerprint.webgl.renderer}';
            // VENDOR
            if (parameter === 3571) return '${fingerprint.webgl.vendor.split(' ')[0]}';
            // RENDERER
            if (parameter === 3572) return '${fingerprint.webgl.renderer}';
            return getParameter.apply(this, arguments);
          }, 'getParameter');
        };

        if (window.WebGLRenderingContext) maskWebGL(WebGLRenderingContext.prototype);
        if (window.WebGL2RenderingContext) maskWebGL(WebGL2RenderingContext.prototype);

        // --- window.chrome Mocking ---
        if (!window.chrome) {
          window.chrome = {
            runtime: {},
            loadTimes: makeNative(() => ({
              requestTime: Date.now() / 1000,
              startLoadTime: Date.now() / 1000,
              commitLoadTime: Date.now() / 1000,
              finishDocumentLoadTime: Date.now() / 1000,
              finishLoadTime: Date.now() / 1000,
              firstPaintTime: Date.now() / 1000,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true,
              wasAlternateProtocolAvailable: false,
              connectionInfo: 'h2'
            }), 'loadTimes'),
            csi: makeNative(() => ({
              startE: Date.now(),
              onloadT: Date.now() + 100,
              pageT: 200,
              tran: 15
            }), 'csi')
          };
        }

        // --- Canvas Protection ---
        const manipulateCanvas = (proto) => {
          if (!proto) return;
          const getImageData = proto.getImageData;
          proto.getImageData = makeNative(function() {
            const res = getImageData.apply(this, arguments);
            if (res && res.data && res.data.length >= 4) {
              const lastIdx = res.data.length - 4;
              res.data[lastIdx] = (res.data[lastIdx] + 1) % 256;
            }
            return res;
          }, 'getImageData');
        };

        if (window.CanvasRenderingContext2D) manipulateCanvas(CanvasRenderingContext2D.prototype);
        
        // --- WebRTC IP Leak Protection ---
        if (window.RTCPeerConnection) {
          const orgRTCPeerConnection = window.RTCPeerConnection;
          window.RTCPeerConnection = makeNative(function(config) {
            const conn = new orgRTCPeerConnection(config);
            const orgAddIceCandidate = conn.addIceCandidate;
            conn.addIceCandidate = makeNative(function() {
              return orgAddIceCandidate.apply(this, arguments);
            }, 'addIceCandidate');
            return conn;
          }, 'RTCPeerConnection');
        }

        // --- WebDriver/Automation Protection ---
        overwriteProperty(navigator, 'webdriver', false);

        // --- Permissions API Hardening ---
        if (navigator.permissions) {
          const orgQuery = navigator.permissions.query;
          navigator.permissions.query = makeNative((parameters) => (
            parameters.name === 'notifications' 
              ? Promise.resolve({ state: 'default', onchange: null }) 
              : orgQuery.apply(navigator.permissions, [parameters])
          ), 'query');
        }

        // --- Timezone Spoofing ---
        // Mismatch antara IP negara dan timezone browser adalah sinyal bot paling
        // mudah dideteksi. Kedua titik yang dicek fingerprinter:
        //   1. Date.prototype.getTimezoneOffset() → offset menit dari UTC
        //   2. Intl.DateTimeFormat().resolvedOptions().timeZone → IANA timezone name
        Date.prototype.getTimezoneOffset = makeNative(function() {
          return ${fingerprint.timezoneOffset};
        }, 'getTimezoneOffset');

        try {
          const _origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
          Intl.DateTimeFormat.prototype.resolvedOptions = makeNative(function() {
            const opts = _origResolvedOptions.call(this);
            opts.timeZone = '${fingerprint.timezone}';
            return opts;
          }, 'resolvedOptions');
        } catch(e) {}

        // --- navigator.connection (Network Information API) ---
        // Desktop wifi = sinyal premium untuk ad network (CPM lebih tinggi dari 4g mobile).
        // Beberapa fingerprinter cek apakah connection.type konsisten dengan UA device.
        try {
          const _connType    = '${fingerprint.connectionType}';
          const _isWifi      = _connType === 'wifi';
          const _mockConn = {
            type:          _connType,
            effectiveType: '4g',
            downlink:      _isWifi ? (10 + Math.random() * 40) : (3 + Math.random() * 12),
            rtt:           _isWifi ? (20 + Math.random() * 60)  : (50 + Math.random() * 100),
            saveData:      false,
            onchange:      null,
          };
          Object.defineProperty(navigator, 'connection',        { get: () => _mockConn, configurable: true });
          Object.defineProperty(navigator, 'mozConnection',     { get: () => _mockConn, configurable: true });
          Object.defineProperty(navigator, 'webkitConnection',  { get: () => _mockConn, configurable: true });
        } catch(e) {}

      })();
    `;
  }
}
