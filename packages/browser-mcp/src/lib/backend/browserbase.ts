import Browserbase from '@browserbasehq/sdk';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { DEFAULT_TIMEOUT_MS } from '../config.js';
import { type BrowserBackend, logEvent } from './types.js';

/** Data-residency regions supported by Browserbase (from the SDK's SessionCreateParams). */
export type BrowserbaseRegion = 'us-west-2' | 'us-east-1' | 'eu-central-1' | 'ap-southeast-1';
export const BROWSERBASE_REGIONS: readonly BrowserbaseRegion[] = [
  'us-west-2',
  'us-east-1',
  'eu-central-1',
  'ap-southeast-1',
];

export interface BrowserbaseConfig {
  apiKey: string;
  /** Optional — the SDK treats projectId as optional (the API key scopes to a
   * default project). Passed through to create/release only when set. */
  projectId?: string;
  /** Persistent Browserbase Context id — carries the login across sessions. */
  contextId?: string;
  /** Data-residency region (e.g. eu-central-1 for governance-sensitive brands). */
  region?: BrowserbaseRegion;
}

/** HTTP statuses that must NOT be retried (auth / quota — retrying wastes cost). */
const NON_RETRYABLE = new Set([401, 403, 404, 429]);

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

/**
 * Connects to a remote Browserbase cloud browser over CDP. Same `Page`
 * contract as LocalBackend, so the tools are unaffected. Sessions bill for
 * their lifetime, so close() MUST release the session.
 */
export class BrowserbaseBackend implements BrowserBackend {
  readonly name = 'browserbase' as const;
  private bb: Browserbase;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;

  constructor(private readonly cfg: BrowserbaseConfig) {
    this.bb = new Browserbase({ apiKey: cfg.apiKey });
  }

  async getPage(): Promise<Page> {
    if (!this.browser) {
      const started = Date.now();
      const session = await this.createSession();
      this.sessionId = session.id;
      logEvent({ backend: 'browserbase', event: 'created', session_id: session.id });
      this.browser = await puppeteer.connect({ browserWSEndpoint: session.connectUrl });
      logEvent({
        backend: 'browserbase',
        event: 'connected',
        session_id: session.id,
        duration_ms: Date.now() - started,
      });
    }
    if (!this.page) {
      const pages = await this.browser.pages();
      this.page = pages[0] ?? (await this.browser.newPage());
      this.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    }
    return this.page;
  }

  /** Create a session with ONE bounded retry on transient failures only. */
  private async createSession(): Promise<{ id: string; connectUrl: string }> {
    try {
      return await this.create();
    } catch (err) {
      const status = statusOf(err);
      if (status !== undefined && NON_RETRYABLE.has(status)) {
        logEvent({ backend: 'browserbase', event: 'failed', stage: 'create', status });
        throw err;
      }
      // Transient (network / 5xx / unknown): one retry after a short backoff.
      await new Promise((r) => setTimeout(r, 1000));
      try {
        return await this.create();
      } catch (err2) {
        logEvent({ backend: 'browserbase', event: 'failed', stage: 'create_retry', status: statusOf(err2) });
        throw err2;
      }
    }
  }

  private async create(): Promise<{ id: string; connectUrl: string }> {
    const session = await this.bb.sessions.create({
      ...(this.cfg.projectId ? { projectId: this.cfg.projectId } : {}),
      ...(this.cfg.region ? { region: this.cfg.region } : {}),
      ...(this.cfg.contextId
        ? { browserSettings: { context: { id: this.cfg.contextId, persist: true } } }
        : {}),
    });
    return { id: session.id, connectUrl: session.connectUrl };
  }

  async close(): Promise<void> {
    // Disconnect the CDP client, then request the cloud session be released so
    // it stops billing. Both are best-effort and safe to call repeatedly.
    if (this.browser) {
      try {
        await this.browser.disconnect();
      } catch {
        /* already gone */
      }
      this.browser = null;
      this.page = null;
    }
    if (this.sessionId) {
      const id = this.sessionId;
      this.sessionId = null;
      try {
        await this.bb.sessions.update(id, {
          ...(this.cfg.projectId ? { projectId: this.cfg.projectId } : {}),
          status: 'REQUEST_RELEASE',
        });
        logEvent({ backend: 'browserbase', event: 'closed', session_id: id });
      } catch (err) {
        // Browserbase's own session timeout is the backstop if release fails.
        logEvent({ backend: 'browserbase', event: 'release_failed', session_id: id, status: statusOf(err) });
      }
    }
  }
}
