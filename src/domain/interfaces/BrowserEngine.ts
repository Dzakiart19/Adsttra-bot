export interface BrowserOptions {
  headless?: boolean | 'new';
  userAgent?: string;
  userDataDir?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  viewport?: {
    width: number;
    height: number;
  };
  platform?: string;
  fingerprintScript?: string;
  acceptLanguage?: string;  // e.g. "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7"
}

export interface BrowserEngine {
  init(options: BrowserOptions): Promise<void>;
  navigate(url: string): Promise<void>;
  wait(ms: number): Promise<void>;
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
  scroll(deltaX: number, deltaY: number): Promise<void>;
  mouseMove(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  close(): Promise<void>;
  setExtraHeaders(headers: Record<string, string>): Promise<void>;
  setGeolocation(latitude: number, longitude: number): Promise<void>;
  waitForNetworkIdle(): Promise<void>;
  randomDelay(min: number, max: number): Promise<void>;
  clickLinkByHref(href: string): Promise<boolean>;
  clickLinkContainingHref(partialHref: string): Promise<boolean>;
  clickLinkByText(text: string): Promise<boolean>;
  clickNextSearchPage(): Promise<boolean>;
  clickSearchResult(pattern: string): Promise<boolean>;
  searchKeyword(keyword: string): Promise<void>;
  handleConsentPopups(): Promise<boolean>;
}
