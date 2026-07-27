/**
 * MCP access-token minting and verification (spec-mcp-lfid-access.md §3).
 *
 * Access tokens are stateless HS256 JWTs, audience-bound to the MCP
 * endpoint, carrying the user's resolved scopes plus identity claims for
 * audit. Refresh tokens are opaque 256-bit secrets whose sha256 lands in
 * mcp_sessions — deleting the row revokes the session at next refresh.
 *
 * The signing secret is MCP_TOKEN_SECRET (dedicated, shared with the MCP
 * pod via deploy config). No fallback to the Supabase JWT_SECRET: these
 * tokens must never validate as platform session tokens or vice versa.
 */
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

export interface McpTokenClaims {
  sub: string; // LFID sub or platform auth user id
  email: string;
  person_id: string;
  tier: string; // comma-joined group names, for audit/UI
  auth_mode: 'lfid' | 'magic_link';
  scope: string; // space-separated per OAuth convention
  client_id: string;
}

const ACCESS_TOKEN_TTL_S = 60 * 60; // 1h — policy changes converge within this

function secret(): string {
  const s = process.env.MCP_TOKEN_SECRET;
  if (!s) throw new Error('MCP_TOKEN_SECRET is not set');
  return s;
}

export function mcpAudience(): string {
  const aud = process.env.PUBLIC_MCP_URL;
  if (!aud) throw new Error('PUBLIC_MCP_URL is not set (MCP token audience)');
  return aud.replace(/\/+$/, '');
}

export function mintAccessToken(claims: McpTokenClaims): { token: string; expiresIn: number } {
  const token = jwt.sign(claims as unknown as Record<string, unknown>, secret(), {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_S,
    audience: mcpAudience(),
    issuer: process.env.API_URL ?? 'gatewaze-api',
  });
  return { token, expiresIn: ACCESS_TOKEN_TTL_S };
}

export function verifyAccessToken(token: string): McpTokenClaims & { aud: string } {
  return jwt.verify(token, secret(), {
    algorithms: ['HS256'],
    audience: mcpAudience(),
  }) as McpTokenClaims & { aud: string };
}

export function newRefreshToken(): { raw: string; hash: string } {
  const raw = `mcr_${randomBytes(32).toString('hex')}`;
  return { raw, hash: sha256(raw) };
}

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}
