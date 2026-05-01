import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Spy on @sentry/node so we can verify init was/wasn't called without
// hitting the real Sentry SDK during the test.
vi.mock('@sentry/node', () => {
  const actual = {
    init: vi.fn(),
    captureException: vi.fn(),
    flush: vi.fn().mockResolvedValue(true),
  };
  return { ...actual, default: actual };
});

import * as Sentry from '@sentry/node';
import { initSentry, captureException } from '../sentry.js';

describe('initSentry', () => {
  let savedDsn: string | undefined;
  beforeEach(() => {
    savedDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    vi.clearAllMocks();
    // Reset internal initialised flag — we re-import sentry.ts in
    // a fresh module graph by clearing the module cache.
    vi.resetModules();
  });
  afterEach(() => {
    if (savedDsn !== undefined) process.env.SENTRY_DSN = savedDsn;
  });

  it('is a no-op when SENTRY_DSN is unset', async () => {
    const { initSentry: freshInit } = await import('../sentry.js');
    freshInit({ service: 'api' });
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/1';
    const { initSentry: freshInit } = await import('../sentry.js');
    freshInit({ service: 'worker' });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const args = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.dsn).toBe('https://test@sentry.io/1');
    expect(args.initialScope.tags.service).toBe('worker');
  });

  it('is idempotent — second call does NOT re-init', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/1';
    const { initSentry: freshInit } = await import('../sentry.js');
    freshInit({ service: 'api' });
    freshInit({ service: 'api' });
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it('captureException is a no-op when not initialised', async () => {
    const { captureException: freshCapture } = await import('../sentry.js');
    freshCapture(new Error('boom'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captureException calls Sentry.captureException after init', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/1';
    const { initSentry: freshInit, captureException: freshCapture } = await import('../sentry.js');
    freshInit({ service: 'api' });
    freshCapture(new Error('boom'), { x: 1 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('beforeSend filters rate_limited and validation_failed', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/1';
    const { initSentry: freshInit } = await import('../sentry.js');
    freshInit({ service: 'api' });
    const initArgs = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initArgs.beforeSend({ tags: { 'error.code': 'rate_limited' } })).toBeNull();
    expect(initArgs.beforeSend({ tags: { 'error.code': 'validation_failed' } })).toBeNull();
    expect(initArgs.beforeSend({ tags: { 'error.code': 'internal_error' } })).not.toBeNull();
  });
});

void initSentry; // ensure top-level import isn't tree-shaken in test mode
void captureException;
