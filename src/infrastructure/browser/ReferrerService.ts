import { Logger } from 'winston';

export class ReferrerService {
  private static readonly DEFAULT_REFERRERS = [
    // Social media (web version — kirim Referer secara normal)
    'https://www.facebook.com/',
    'https://www.instagram.com/',
    'https://x.com/',
    'https://twitter.com/',
    'https://t.co/',                        // Twitter link shortener
    'https://www.tiktok.com/',
    'https://www.youtube.com/',
    'https://www.pinterest.com/',
    'https://www.linkedin.com/',
    // Community / forum
    'https://www.reddit.com/',
    'https://news.ycombinator.com/',
    'https://www.quora.com/',
    // Messaging (app-based — spoofed; analytics mungkin catat sebagai referral)
    'https://web.whatsapp.com/',
    'https://t.me/',
    'https://web.telegram.org/',
  ];

  private static readonly SEARCH_ENGINES = [
    { name: 'Google', url: 'https://www.google.com/search?q=' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=' },
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  ];

  constructor(private readonly logger: Logger) {}

  // ── Alias pendek → URL lengkap ─────────────────────────────────────────────
  // Pengguna boleh set REFERRER_POOL=google,facebook,youtube (lebih mudah dibaca)
  // dan kode akan expand ke URL lengkap sebelum di-set sebagai Referer header.
  private static readonly REFERRER_ALIASES: Record<string, string> = {
    'google':    'https://www.google.com/',
    'google.com':'https://www.google.com/',
    'bing':      'https://www.bing.com/',
    'yahoo':     'https://www.yahoo.com/',
    'facebook':  'https://www.facebook.com/',
    'instagram': 'https://www.instagram.com/',
    'twitter':   'https://twitter.com/',
    'x.com':     'https://x.com/',
    't.co':      'https://t.co/',
    'youtube':   'https://www.youtube.com/',
    'tiktok':    'https://www.tiktok.com/',
    'reddit':    'https://www.reddit.com/',
    'pinterest': 'https://www.pinterest.com/',
    'linkedin':  'https://www.linkedin.com/',
    'quora':     'https://www.quora.com/',
    'telegram':  'https://web.telegram.org/',
    'whatsapp':  'https://web.whatsapp.com/',
  };

  /**
   * Returns a random high-authority referrer URL.
   * Supports short aliases (e.g. "google") or full URLs (e.g. "https://www.google.com/").
   */
  getRandomReferrer(customPool: string[] = []): string {
    const pool = customPool.length > 0 ? customPool : ReferrerService.DEFAULT_REFERRERS;
    const index = Math.floor(Math.random() * pool.length);
    const raw = pool[index].trim().toLowerCase();
    // Expand alias ke URL lengkap jika ada; jika tidak, kembalikan nilai asli
    return ReferrerService.REFERRER_ALIASES[raw] ?? pool[index];
  }

  /**
   * Returns a search engine URL with the given keyword, optionally filtering by preferred engine.
   */
  getRandomSearchUrl(keyword: string, preferredEngine: string = 'random'): { name: string; url: string } {
    let pool = ReferrerService.SEARCH_ENGINES;
    if (preferredEngine !== 'random') {
      const filtered = pool.filter(e => e.name.toLowerCase() === preferredEngine.toLowerCase());
      if (filtered.length > 0) pool = filtered;
    }
    
    const engine = pool[Math.floor(Math.random() * pool.length)];
    return {
      name: engine.name,
      url: `${engine.url}${encodeURIComponent(keyword)}`,
    };
  }

  /**
   * Returns a random keyword from the provided list.
   */
  getRandomKeyword(keywords: string[]): string {
    if (keywords.length === 0) return 'traffic bot';
    return keywords[Math.floor(Math.random() * keywords.length)];
  }

  /**
   * Returns the homepage URL for a given search engine.
   */
  public getSearchHomepage(engineOption: 'google' | 'bing' | 'duckduckgo' | 'random'): { name: string; url: string } {
    const engines = ['google', 'bing', 'duckduckgo'];
    let targetEngine = engineOption;
    
    if (targetEngine === 'random') {
      targetEngine = engines[Math.floor(Math.random() * engines.length)] as 'google' | 'bing' | 'duckduckgo';
    }

    switch (targetEngine) {
      case 'bing':
        return { name: 'Bing', url: 'https://www.bing.com/' };
      case 'duckduckgo':
        return { name: 'DuckDuckGo', url: 'https://duckduckgo.com/' };
      case 'google':
      default:
        return { name: 'Google', url: 'https://www.google.com/' };
    }
  }
}
