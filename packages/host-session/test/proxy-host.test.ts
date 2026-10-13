// What a host needs from proxyRequest beyond the admin BFF's use: a wrapped
// request body (a byte limit, for example), and anon credentials that never
// send a publishable key as a bearer token.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ProxyCredentials, anonCredentials, isPublishableKey, proxyRequest, upstreamHeaders } from '../src/proxy.js';
import { call } from './helpers/fakes.js';

class TooLargeError extends Error {}

// Passes bytes through until more than `max` have gone by, then errors.
function byteLimit(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      seen += chunk.length;
      if (seen > max) return cb(new TooLargeError(`body over ${max} bytes`));
      cb(null, chunk);
    },
  });
}

interface Seen {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  aborted: boolean;
}

let upstream: http.Server;
let upstreamUrl = '';
const seen: Seen[] = [];

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    const entry: Seen = { method: req.method ?? '', headers: req.headers, body: '', aborted: false };
    seen.push(entry);
    try {
      for await (const c of req) chunks.push(c as Buffer);
    } catch {
      entry.aborted = true;
      return;
    }
    if (!req.complete) {
      entry.aborted = true;
      return;
    }
    entry.body = Buffer.concat(chunks).toString();
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
});

const hosts: http.Server[] = [];
afterEach(async () => {
  seen.length = 0;
  for (const h of hosts.splice(0)) {
    h.closeAllConnections();
    await new Promise((r) => h.close(r));
  }
});

// A minimal host: proxies /rest/v1/* with the given body wrapper and maps a
// TooLargeError to 413, anything else to 502.
async function startHost(wrap?: (req: http.IncomingMessage) => Readable): Promise<string> {
  const host = http.createServer(async (req, res) => {
    try {
      const r = await proxyRequest(req, { url: upstreamUrl, prefix: '/rest/v1', supabase: true }, req.url ?? '/', {
        creds: { bearer: null, apikey: 'anon' },
        xff: '',
        timeoutMs: 5000,
        downstream: res,
        body: wrap?.(req),
      });
      res.writeHead(r.status, r.headers);
      r.body.pipe(res);
    } catch (e) {
      res.writeHead(e instanceof TooLargeError ? 413 : 502).end();
    }
  });
  hosts.push(host);
  await new Promise<void>((r) => host.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
}

describe('proxyRequest body option', () => {
  it('sends the wrapped stream instead of the raw request', async () => {
    const upper = (req: http.IncomingMessage) =>
      req.pipe(
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            cb(null, chunk.toString().toUpperCase());
          },
        }),
      );
    const base = await startHost(upper);
    const r = await call(base, 'POST', '/rest/v1/notes', { 'content-type': 'text/plain' }, 'hello body');
    expect(r.status).toBe(200);
    expect(seen[0].body).toBe('HELLO BODY');
  });

  it('passes a body under the limit through unchanged', async () => {
    const base = await startHost((req) => req.pipe(byteLimit(64)));
    const r = await call(base, 'POST', '/rest/v1/notes', {}, 'x'.repeat(64));
    expect(r.status).toBe(200);
    expect(seen[0].body).toBe('x'.repeat(64));
  });

  it('rejects with the wrapper error and aborts the upstream request when the limit is passed', async () => {
    const base = await startHost((req) => req.pipe(byteLimit(10)));
    const r = await call(base, 'POST', '/rest/v1/notes', {}, 'y'.repeat(70_000));
    expect(r.status).toBe(413);
    // The upstream never got a complete body.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.every((s) => s.aborted || s.body === '')).toBe(true);
    expect(seen.some((s) => s.body.length === 70_000)).toBe(false);
  });

  it('still pipes the raw request when no body is given', async () => {
    const base = await startHost();
    const r = await call(base, 'PUT', '/rest/v1/notes', {}, 'raw body');
    expect(r.status).toBe(200);
    expect(seen[0].body).toBe('raw body');
  });
});

describe('anon credentials', () => {
  const JWT_ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln';
  const PUBLISHABLE = 'sb_publishable_abc123';

  it('recognises only sb_publishable_ keys as publishable', () => {
    expect(isPublishableKey(PUBLISHABLE)).toBe(true);
    expect(isPublishableKey(JWT_ANON)).toBe(false);
    expect(isPublishableKey('anon-key-public')).toBe(false);
    expect(isPublishableKey('sb_secret_abc123')).toBe(false);
  });

  it('sends a JWT anon key as both apikey and bearer to Supabase', () => {
    expect(anonCredentials(JWT_ANON, true)).toEqual({ bearer: JWT_ANON, apikey: JWT_ANON });
  });

  it('sends a publishable key in apikey only', () => {
    const creds: ProxyCredentials = anonCredentials(PUBLISHABLE, true);
    expect(creds).toEqual({ bearer: null, apikey: PUBLISHABLE });
    const out = upstreamHeaders({ authorization: 'Bearer host-session', apikey: 'browser-sent' }, creds, '');
    expect(out.authorization).toBeUndefined();
    expect(out.apikey).toBe(PUBLISHABLE);
  });

  it('sends nothing to a non-Supabase upstream', () => {
    expect(anonCredentials(JWT_ANON, false)).toEqual({ bearer: null, apikey: null });
    expect(anonCredentials(PUBLISHABLE, false)).toEqual({ bearer: null, apikey: null });
  });
});
