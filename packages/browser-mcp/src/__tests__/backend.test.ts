import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the external browser surfaces so the suite needs no real network ────
const sessionsCreate = vi.fn();
const sessionsUpdate = vi.fn();
const fetchApiCreate = vi.fn();
const searchWeb = vi.fn();
const puppeteerConnect = vi.fn();

vi.mock('@browserbasehq/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    sessions: { create: sessionsCreate, update: sessionsUpdate },
    fetchAPI: { create: fetchApiCreate },
    search: { web: searchWeb },
  })),
}));

vi.mock('puppeteer-core', () => ({
  default: { connect: (...a: unknown[]) => puppeteerConnect(...a), launch: vi.fn() },
}));

import { assertNavigable, BlockedUrlError } from '../lib/url-guard.js';
import { resolveBackend } from '../lib/backend/index.js';
import { LocalBackend } from '../lib/backend/local.js';
import { BrowserbaseBackend } from '../lib/backend/browserbase.js';
import { BrowserbaseWeb } from '../lib/browserbase-web.js';

beforeEach(() => {
  sessionsCreate.mockReset();
  sessionsUpdate.mockReset();
  fetchApiCreate.mockReset();
  searchWeb.mockReset();
  puppeteerConnect.mockReset();
});

// ── Backend resolver ──────────────────────────────────────────────────────────
describe('resolveBackend', () => {
  it('defaults to local when BROWSER_MCP_BACKEND is unset', () => {
    expect(resolveBackend({}).name).toBe('local');
  });

  it('returns local explicitly', () => {
    expect(resolveBackend({ BROWSER_MCP_BACKEND: 'local' }).name).toBe('local');
  });

  it('throws when browserbase is selected without an API key', () => {
    expect(() =>
      resolveBackend({ BROWSER_MCP_BACKEND: 'browserbase', BROWSERBASE_PROJECT_ID: 'p1' }),
    ).toThrow(/BROWSERBASE_API_KEY/);
  });

  it('throws when browserbase is selected without a project id', () => {
    expect(() =>
      resolveBackend({ BROWSER_MCP_BACKEND: 'browserbase', BROWSERBASE_API_KEY: 'k' }),
    ).toThrow(/BROWSERBASE_PROJECT_ID/);
  });

  it('returns browserbase when fully configured', () => {
    const b = resolveBackend({
      BROWSER_MCP_BACKEND: 'browserbase',
      BROWSERBASE_API_KEY: 'k',
      BROWSERBASE_PROJECT_ID: 'p1',
    });
    expect(b.name).toBe('browserbase');
  });

  it('rejects an unknown backend', () => {
    expect(() => resolveBackend({ BROWSER_MCP_BACKEND: 'nope' })).toThrow(/Unknown/);
  });
});

// ── SSRF guard (runs on every navigate, both backends) ────────────────────────
describe('assertNavigable (SSRF guard)', () => {
  it('rejects non-http schemes', async () => {
    await expect(assertNavigable('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertNavigable('javascript:alert(1)')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects loopback and localhost', async () => {
    await expect(assertNavigable('http://127.0.0.1/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertNavigable('http://localhost/')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects the cloud metadata address', async () => {
    await expect(assertNavigable('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it('rejects private ranges', async () => {
    await expect(assertNavigable('http://10.0.0.5/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertNavigable('http://192.168.1.1/')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('allows a normal public https URL', async () => {
    await expect(assertNavigable('https://lu.ma/event/manage/evt-1')).resolves.toContain('lu.ma');
  });
});

// ── Browserbase lifecycle (cost / leak control) ───────────────────────────────
describe('BrowserbaseBackend lifecycle', () => {
  const cfg = { apiKey: 'k', projectId: 'p1' };

  function fakeBrowser() {
    return {
      pages: vi.fn().mockResolvedValue([]),
      newPage: vi.fn().mockResolvedValue({ setDefaultTimeout: vi.fn() }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('creates a session, connects, and releases it on close (no orphan)', async () => {
    sessionsCreate.mockResolvedValue({ id: 'sess_1', connectUrl: 'ws://bb/sess_1' });
    puppeteerConnect.mockResolvedValue(fakeBrowser());

    const backend = new BrowserbaseBackend(cfg);
    await backend.getPage();
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(puppeteerConnect).toHaveBeenCalledWith({ browserWSEndpoint: 'ws://bb/sess_1' });

    await backend.close();
    expect(sessionsUpdate).toHaveBeenCalledWith('sess_1', {
      projectId: 'p1',
      status: 'REQUEST_RELEASE',
    });
  });

  it('close() is safe to call twice and only releases once', async () => {
    sessionsCreate.mockResolvedValue({ id: 'sess_2', connectUrl: 'ws://bb/sess_2' });
    puppeteerConnect.mockResolvedValue(fakeBrowser());

    const backend = new BrowserbaseBackend(cfg);
    await backend.getPage();
    await backend.close();
    await backend.close();
    expect(sessionsUpdate).toHaveBeenCalledTimes(1);
  });

  it('retries once on a transient create failure', async () => {
    sessionsCreate
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ id: 'sess_3', connectUrl: 'ws://bb/sess_3' });
    puppeteerConnect.mockResolvedValue(fakeBrowser());

    const backend = new BrowserbaseBackend(cfg);
    await backend.getPage();
    expect(sessionsCreate).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a 401/403/429 (wasted cost) and surfaces the error', async () => {
    const authErr = Object.assign(new Error('unauthorized'), { status: 401 });
    sessionsCreate.mockRejectedValue(authErr);

    const backend = new BrowserbaseBackend(cfg);
    await expect(backend.getPage()).rejects.toThrow(/unauthorized/);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
  });
});

// ── Browserbase Fetch / Search (spec §5 evaluate-only) ────────────────────────
describe('BrowserbaseWeb (Fetch/Search)', () => {
  it('reports unavailable and throws a structured error without an API key', async () => {
    const web = new BrowserbaseWeb(undefined);
    expect(web.available()).toBe(false);
    await expect(web.fetch('https://example.com', 'markdown')).rejects.toThrow(/browserbase_unavailable/);
    await expect(web.search('hi')).rejects.toThrow(/browserbase_unavailable/);
  });

  it('fetch returns content + status from the Fetch API', async () => {
    fetchApiCreate.mockResolvedValue({
      id: 'f1',
      content: '# Title\nbody',
      contentType: 'text/markdown',
      encoding: 'utf-8',
      headers: {},
      statusCode: 200,
    });
    const web = new BrowserbaseWeb('k');
    const res = await web.fetch('https://lu.ma/x', 'markdown');
    expect(fetchApiCreate).toHaveBeenCalledWith({ url: 'https://lu.ma/x', format: 'markdown' });
    expect(res).toEqual({ statusCode: 200, contentType: 'text/markdown', content: '# Title\nbody' });
  });

  it('search returns results from the Search API', async () => {
    searchWeb.mockResolvedValue({
      query: 'goose mcp',
      requestId: 'r1',
      results: [{ id: '1', title: 'Goose', url: 'https://goose.example' }],
    });
    const web = new BrowserbaseWeb('k');
    const res = await web.search('goose mcp', 5);
    expect(searchWeb).toHaveBeenCalledWith({ query: 'goose mcp', numResults: 5 });
    expect(res.results).toHaveLength(1);
  });
});
