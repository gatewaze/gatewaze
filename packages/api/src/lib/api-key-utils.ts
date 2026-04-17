import { createHmac, randomBytes } from 'crypto';

const API_KEY_PREFIX = 'gw_live_';

function getPepper(): Buffer {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) throw new Error('Missing API_KEY_PEPPER environment variable');
  return Buffer.from(pepper, 'base64');
}

/**
 * Compute HMAC-SHA256 of the raw API key using the pepper.
 * Returns the hex-encoded digest.
 */
export function hashApiKey(raw: string): string {
  const pepper = getPepper();
  return createHmac('sha256', pepper).update(raw).digest('hex');
}

/**
 * Generate a new API key with the format `gw_live_<32 hex chars>`.
 * Returns the raw key, its HMAC hash, and the prefix (first 16 chars).
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const randomHex = randomBytes(16).toString('hex');
  const raw = `${API_KEY_PREFIX}${randomHex}`;
  const hash = hashApiKey(raw);
  const prefix = raw.substring(0, 16);
  return { raw, hash, prefix };
}
