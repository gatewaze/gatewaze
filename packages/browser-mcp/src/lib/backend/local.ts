import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { DEFAULT_TIMEOUT_MS } from '../config.js';
import { type BrowserBackend, logEvent } from './types.js';

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';
// Persisting a Chromium profile dir lets a login survive across runs (local
// only — cloud sessions use a Browserbase Context instead).
const USER_DATA_DIR = process.env.BROWSER_MCP_USER_DATA_DIR || undefined;

/** Launches system Chromium in-process. Today's default behaviour. */
export class LocalBackend implements BrowserBackend {
  readonly name = 'local' as const;
  private browser: Browser | null = null;
  private page: Page | null = null;

  async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      logEvent({ backend: 'local', event: 'launched' });
    }
    if (!this.page) {
      const pages = await this.browser.pages();
      this.page = pages[0] ?? (await this.browser.newPage());
      this.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    }
    return this.page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logEvent({ backend: 'local', event: 'closed' });
    }
  }
}
