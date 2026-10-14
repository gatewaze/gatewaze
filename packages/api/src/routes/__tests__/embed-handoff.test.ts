import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';

const getUser = vi.fn();
vi.mock('../../lib/supabase.js', () => ({ getSupabase: () => ({ auth: { getUser } }) }));

const { embedHandoffDepositRouter, embedHandoffClaimRouter, challengeFor } = await import('../embed-handoff.js');

const app = express();
app.use(express.json());
app.use('/deposit', embedHandoffDepositRouter);
app.use('/claim', embedHandoffClaimRouter);

const secret = () => randomBytes(32).toString('base64url');
// A JWT-shaped token whose payload carries exp; the signature is never
// checked here because Supabase Auth (mocked) is the verifier.
const token = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ sub: 'u1', exp })).toString('base64url')}.s`;

describe('embed sign-in handoff', () => {
  beforeEach(() => {
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  });

  it('hands the access token to whoever holds the secret, once', async () => {
    const s = secret();
    const t = token(1_900_000_000);
    const dep = await request(app).post('/deposit').set('Authorization', `Bearer ${t}`).send({ challenge: challengeFor(s) });
    expect(dep.status).toBe(200);
    expect(getUser).toHaveBeenCalledWith(t);

    const first = await request(app).post('/claim').send({ secret: s });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ access_token: t, expires_at: 1_900_000_000 });
    expect(first.headers['cache-control']).toBe('no-store');

    const second = await request(app).post('/claim').send({ secret: s });
    expect(second.status).toBe(404);
  });

  it('gives nothing for a different secret', async () => {
    const s = secret();
    await request(app).post('/deposit').set('Authorization', `Bearer ${token(1)}`).send({ challenge: challengeFor(s) });
    const res = await request(app).post('/claim').send({ secret: secret() });
    expect(res.status).toBe(404);
  });

  it('will not replace a deposit already made for a challenge', async () => {
    const s = secret();
    const ch = challengeFor(s);
    await request(app).post('/deposit').set('Authorization', `Bearer ${token(1)}`).send({ challenge: ch });
    const again = await request(app).post('/deposit').set('Authorization', `Bearer ${token(2)}`).send({ challenge: ch });
    expect(again.status).toBe(409);
    const claimed = await request(app).post('/claim').send({ secret: s });
    expect(claimed.body.expires_at).toBe(1);
  });

  it('refuses a deposit without a token, or one Supabase Auth rejects', async () => {
    const ch = challengeFor(secret());
    expect((await request(app).post('/deposit').send({ challenge: ch })).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    expect((await request(app).post('/deposit').set('Authorization', 'Bearer nope').send({ challenge: ch })).status).toBe(401);
  });

  it.each([
    ['deposit', { challenge: 'not-hex' }],
    ['claim', { secret: 'short' }],
  ])('rejects a malformed %s body', async (route, body) => {
    const res = await request(app).post(`/${route}`).set('Authorization', `Bearer ${token(1)}`).send(body);
    expect(res.status).toBe(400);
  });
});
