import { describe, it, expect, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { ipRateLimiter } from '../rate-limiter.js';

// No REDIS_URL is set in test/setup.ts, so ipRateLimiter() falls back to
// the in-process store. That is the branch under test here: the Redis
// branch shares the same consume/reject contract.

function buildApp(points: number) {
  // Stands in for everything a router installs behind the limiter —
  // requireJwt() on the real app. The point of the limiter is that this
  // does not run once a caller is over the cap.
  const downstream = vi.fn((_req: Request, _res: Response, next: NextFunction) => next());

  const app = express();
  // Mirrors server.ts, so req.ip is the forwarded client address.
  app.set('trust proxy', true);
  app.use(ipRateLimiter({ points, durationSecs: 60, bucket: 'test' }));
  app.use(downstream);
  app.get('/thing', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return { app, downstream };
}

describe('ipRateLimiter', () => {
  it('lets a caller through up to the cap', async () => {
    const { app } = buildApp(2);

    const first = await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.1');
    const second = await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.1');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('answers 429 with a Retry-After once the caller is over the cap', async () => {
    const { app } = buildApp(1);

    await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.2');
    const res = await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.2');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('rejects before anything behind it runs', async () => {
    // The regression test for the ordering bug: the limiter used to sit
    // behind requireJwt(), so the JWT verification — an outbound round
    // trip for a cloud-issued token — ran on every request no matter how
    // many a caller sent.
    const { app, downstream } = buildApp(1);

    await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.3');
    expect(downstream).toHaveBeenCalledTimes(1);

    const res = await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.3');

    expect(res.status).toBe(429);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('counts each client IP separately', async () => {
    const { app } = buildApp(1);

    await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.4');
    const other = await request(app).get('/thing').set('X-Forwarded-For', '203.0.113.5');

    expect(other.status).toBe(200);
  });

  it('fails open when the store itself errors', async () => {
    // A store failure rejects with an Error; being over the cap rejects
    // with a RateLimiterRes. Only the second is a 429 — a Redis outage
    // must not take the API down with it.
    vi.resetModules();
    vi.doMock('rate-limiter-flexible', () => {
      class BrokenStore {
        consume(): Promise<never> {
          return Promise.reject(new Error('redis is down'));
        }
      }
      return { RateLimiterRedis: BrokenStore, RateLimiterMemory: BrokenStore };
    });

    const { ipRateLimiter: withBrokenStore } = await import('../rate-limiter.js');
    const app = express();
    app.use(withBrokenStore({ points: 1, durationSecs: 60, bucket: 'broken' }));
    app.get('/thing', (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const first = await request(app).get('/thing');
    const second = await request(app).get('/thing');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    vi.doUnmock('rate-limiter-flexible');
    vi.resetModules();
  });
});
