// The request logger never writes cookies, credentials or URL-borne tokens.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loggerOptions } from '../src/app.js';
import { call } from './helpers/fakes.js';
import { ANON, type Harness, SITE, startHarness } from './helpers/harness.js';

let h: Harness;
const lines: string[] = [];

beforeAll(async () => {
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const base = loggerOptions('trace') as Record<string, unknown>;
  h = await startHarness({ logger: { ...base, stream } });
  h.supabase.addUser('u-admin', 'admin@example.test', true);
});
afterAll(() => h.close());

it('redacts cookies, authorization and query tokens', async () => {
  const s = await h.signIn('u-admin');
  await call(h.base, 'GET', '/api/x?access_token=leaky-query-token', {
    cookie: s.cookie,
    origin: SITE,
    apikey: ANON,
    authorization: 'Bearer leaky-header-token',
  });
  const log = lines.join('');
  expect(log).toContain('/api/x?access_token=[redacted]');
  expect(log).not.toContain('leaky-query-token');
  expect(log).not.toContain('leaky-header-token');
  expect(log).not.toContain(s.cookie.split('=')[1]);
  expect(log).not.toContain(s.session.access_token);
});

it('redacts credentials in any headers object a handler logs', () => {
  lines.length = 0;
  h.app.log.warn({ headers: { cookie: 'c-secret', authorization: 'Bearer a-secret', apikey: 'k-secret', 'set-cookie': 's-secret', accept: 'x' } }, 'top level');
  h.app.log.warn({ upstream: { headers: { cookie: 'c2-secret', authorization: 'Bearer a2-secret' } } }, 'nested');
  const log = lines.join('');
  for (const secret of ['c-secret', 'a-secret', 'k-secret', 's-secret', 'c2-secret', 'a2-secret']) expect(log).not.toContain(secret);
  expect(log).toContain('[redacted]');
  expect(log).toContain('"accept":"x"');
});
