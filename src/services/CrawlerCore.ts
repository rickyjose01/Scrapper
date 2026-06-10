import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface CrawlerConfig {
  proxyUrl?: string;
  delayMin?: number; // Minimum delay in milliseconds between requests (default: 2000)
  delayMax?: number; // Maximum delay in milliseconds between requests (default: 5000)
  timeout?: number;  // Request timeout in milliseconds (default: 15000)
  maxRetries?: number; // Maximum retries on error (default: 3)
}

const DEFAULT_USER_AGENTS = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Firefox on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
];

export class CrawlerCore {
  private config: Required<CrawlerConfig>;
  private axiosInstance: AxiosInstance;
  private lastRequestTime: number = 0;

  constructor(config: CrawlerConfig = {}) {
    this.config = {
      proxyUrl: config.proxyUrl || '',
      delayMin: config.delayMin !== undefined ? config.delayMin : 2000,
      delayMax: config.delayMax !== undefined ? config.delayMax : 5000,
      timeout: config.timeout !== undefined ? config.timeout : 15000,
      maxRetries: config.maxRetries !== undefined ? config.maxRetries : 3
    };

    const axiosOpts: AxiosRequestConfig = {
      timeout: this.config.timeout,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      }
    };

    // Apply proxy if configured
    if (this.config.proxyUrl) {
      const url = new URL(this.config.proxyUrl);
      axiosOpts.proxy = {
        protocol: url.protocol.replace(':', ''),
        host: url.hostname,
        port: parseInt(url.port) || 80,
        auth: url.username ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password)
        } : undefined
      };
    }

    this.axiosInstance = axios.create(axiosOpts);
  }

  /**
   * Returns a random user agent from the pool
   */
  private getRandomUserAgent(): string {
    const idx = Math.floor(Math.random() * DEFAULT_USER_AGENTS.length);
    return DEFAULT_USER_AGENTS[idx];
  }

  /**
   * Helper utility to sleep
   */
  public async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Enforces delay between consecutive requests to mimic human behavior
   */
  private async enforceDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Generate a random delay between min and max
    const randomDelay = this.config.delayMin + Math.random() * (this.config.delayMax - this.config.delayMin);
    
    if (timeSinceLastRequest < randomDelay) {
      const waitTime = randomDelay - timeSinceLastRequest;
      await this.sleep(waitTime);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetches HTML content from a URL with stealth headers, delays, and retry logic.
   */
  public async fetch(url: string, customHeaders: Record<string, string> = {}): Promise<string> {
    await this.enforceDelay();

    let attempt = 0;
    const userAgent = this.getRandomUserAgent();
    
    // Dynamically set realistic Referer if we are scraping a page that isn't the root
    let referer = 'https://www.google.com/';
    try {
      const parsedUrl = new URL(url);
      referer = `${parsedUrl.protocol}//${parsedUrl.host}/`;
    } catch (e) {
      // ignore
    }

    const headers = {
      'User-Agent': userAgent,
      'Referer': referer,
      ...customHeaders
    };

    while (attempt < this.config.maxRetries) {
      try {
        const response = await this.axiosInstance.get(url, { headers });
        return response.data;
      } catch (error: any) {
        attempt++;
        const statusCode = error.response?.status;
        console.warn(`[CrawlerCore] Fetch failed for ${url} (Attempt ${attempt}/${this.config.maxRetries}). Status: ${statusCode || error.message}`);
        
        if (attempt >= this.config.maxRetries) {
          throw new Error(`Failed to fetch page after ${this.config.maxRetries} attempts. Last error: ${error.message}`);
        }

        // Exponential backoff wait (with additional penalty for rate limit 429)
        let backoffTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        if (statusCode === 429) {
          console.warn(`[CrawlerCore] Received 429 Too Many Requests. Cooling down for 15 seconds...`);
          backoffTime += 15000; // Extra cooldown
        }
        await this.sleep(backoffTime);
      }
    }
    throw new Error('Unreachable state in CrawlerCore');
  }
}
