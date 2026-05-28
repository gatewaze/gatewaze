import type { Page } from 'puppeteer-core';

/**
 * A browser backend provides a single live page for the process lifetime and
 * tears it down on close. Both backends speak the same Puppeteer `Page`, so the
 * MCP tool handlers in server.ts are transport-agnostic — they never know
 * whether the browser is local Chromium or a remote Browserbase session.
 */
export interface BrowserBackend {
  readonly name: 'local' | 'browserbase';
  /** Lazily launch/connect, returning the (reused) page. */
  getPage(): Promise<Page>;
  /** Tear down the browser/session. MUST be safe to call repeatedly. */
  close(): Promise<void>;
}

/** Structured stderr log line (stdout is reserved for the MCP protocol). */
export function logEvent(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}
