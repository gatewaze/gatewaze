import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  ApiError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitedError,
  ConflictError,
  errorEnvelope,
} from '../errors.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/throw/api-error', () => {
    throw new ApiError(418, 'tenant_isolation_violation', 'I am a teapot');
  });
  app.get('/throw/unauthenticated', () => {
    throw new UnauthenticatedError();
  });
  app.get('/throw/forbidden', () => {
    throw new ForbiddenError('not allowed');
  });
  app.get('/throw/not-found', () => {
    throw new NotFoundError();
  });
  app.get('/throw/validation', () => {
    throw new ValidationError('bad input', { field: 'email' });
  });
  app.get('/throw/rate-limit', () => {
    throw new RateLimitedError('too fast', 30);
  });
  app.get('/throw/conflict', () => {
    throw new ConflictError('duplicate');
  });
  app.get('/throw/random', () => {
    throw new Error('something exploded');
  });
  app.use(errorEnvelope);
  return app;
}

describe('errorEnvelope middleware', () => {
  it('wraps ApiError into the standard envelope', async () => {
    const res = await request(buildApp()).get('/throw/api-error');
    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({
      error: { code: 'tenant_isolation_violation', message: 'I am a teapot' },
    });
    // request_id is always present (empty string when no request-id middleware ran).
    expect(res.body.error).toHaveProperty('request_id');
  });

  it('uses 401/unauthenticated for UnauthenticatedError', async () => {
    const res = await request(buildApp()).get('/throw/unauthenticated');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('uses 403/forbidden for ForbiddenError', async () => {
    const res = await request(buildApp()).get('/throw/forbidden');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(res.body.error.message).toBe('not allowed');
  });

  it('uses 404/not_found for NotFoundError', async () => {
    const res = await request(buildApp()).get('/throw/not-found');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('passes details through for ValidationError', async () => {
    const res = await request(buildApp()).get('/throw/validation');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details).toEqual({ field: 'email' });
  });

  it('encodes retry_after for RateLimitedError', async () => {
    const res = await request(buildApp()).get('/throw/rate-limit');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.details).toEqual({ retry_after: 30 });
  });

  it('uses 409/conflict for ConflictError', async () => {
    const res = await request(buildApp()).get('/throw/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('falls through to internal_error for unknown throws', async () => {
    const res = await request(buildApp()).get('/throw/random');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.message).toBe('Internal server error');
  });
});
