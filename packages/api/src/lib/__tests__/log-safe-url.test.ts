import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';

// The real logger writes to stdout; send it to a buffer instead, so the test
// checks the requestLogger the API actually mounts.
const lines: string[] = [];
vi.mock('pino', async (orig) => {
  const real = (await orig<{ default: (opts: unknown, dest: Writable) => unknown }>()).default;
  const sink = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
  const wrapped = Object.assign((opts: unknown) => real(opts, sink), real);
  return { default: wrapped };
});

const { logSafeUrl, requestLogger } = await import('../logger.js');

describe('logSafeUrl', () => {
  it('replaces the query on the MCP native LFID callback', () => {
    expect(logSafeUrl('/api/mcp-auth/lfid/callback/abc?code=secret&x=1')).toBe('/api/mcp-auth/lfid/callback/abc?[REDACTED]');
    expect(logSafeUrl('/API/MCP-AUTH/LFID/CALLBACK/abc?code=secret')).toBe('/API/MCP-AUTH/LFID/CALLBACK/abc?[REDACTED]');
  });

  it('leaves other URLs, and the callback without a query, alone', () => {
    expect(logSafeUrl('/api/mcp-auth/authorize?client_id=x')).toBe('/api/mcp-auth/authorize?client_id=x');
    expect(logSafeUrl('/api/mcp-auth/lfid/callback/abc')).toBe('/api/mcp-auth/lfid/callback/abc');
    expect(logSafeUrl(undefined)).toBeUndefined();
  });
});

describe('requestLogger', () => {
  const app = express();
  app.use(requestLogger);
  app.get('/api/mcp-auth/lfid/callback/:id', (_req, res) => { res.send('ok'); });
  app.get('/api/mcp-auth/lfid/callback/:id/fail', (_req, res) => { res.status(500).send('no'); });
  app.get('/other', (_req, res) => { res.send('ok'); });
  app.get('/redirect', (_req, res) => { res.redirect('https://client.example.test/cb?code=mac_grant_secret'); });

  it.each([
    ['a success', '/api/mcp-auth/lfid/callback/abcdefabcdefabcdef?code=gotrue-secret-code'],
    ['an error', '/api/mcp-auth/lfid/callback/abcdefabcdefabcdef/fail?code=gotrue-secret-code'],
  ])('keeps the GoTrue code out of the access log line for %s', async (_label, url) => {
    lines.length = 0;
    await request(app).get(url);
    const logged = lines.map((l) => JSON.parse(l) as { msg: string; req: { url: string; query: unknown } });
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).not.toContain('gotrue-secret-code');
    expect(logged[0].req.url).toContain('?[REDACTED]');
    expect(logged[0].msg).toContain('?[REDACTED]');
  });

  it('logs other URLs unchanged', async () => {
    lines.length = 0;
    await request(app).get('/other?keep=me');
    const logged = JSON.parse(lines[0]) as { msg: string; req: { url: string } };
    expect(logged.req.url).toBe('/other?keep=me');
    expect(logged.msg).toContain('/other?keep=me');
  });

  it('keeps redirect targets, which can carry grant codes, out of the log', async () => {
    lines.length = 0;
    await request(app).get('/redirect');
    expect(lines.join('')).not.toContain('mac_grant_secret');
  });
});
