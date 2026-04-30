import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../server.js';

describe('GET /api/health', () => {
  it('returns 200 with status, timestamp, version', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    // Status is 'ok' when the queue is reachable, 'degraded' when it
    // isn't configured. Both are valid in this back-compat endpoint —
    // /health/live and /health/ready are the dedicated liveness/readiness
    // probes — so we just check the response shape.
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.version).toBeDefined();
  });
});
