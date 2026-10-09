/**
 * Module secrets encryption utilities.
 * Uses AES-256-GCM for encrypting sensitive configuration values
 * and module source tokens.
 *
 * Ciphertext format: v1:<base64(nonce || ciphertext || tag)>
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1:';

/**
 * Get the encryption key from environment.
 * Returns null if no key is configured.
 */
function getKey(keyEnv: string = 'GATEWAZE_SECRETS_KEY'): Buffer | null {
  const raw = process.env[keyEnv];
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${keyEnv} must be exactly 32 bytes (256 bits) when base64-decoded, got ${buf.length}`);
  }
  return buf;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns ciphertext in format: v1:<base64(nonce || ciphertext || tag)>
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error('GATEWAZE_SECRETS_KEY is not configured; cannot encrypt secrets');
  }

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const combined = Buffer.concat([nonce, encrypted, tag]);
  return VERSION_PREFIX + combined.toString('base64');
}

/**
 * Decrypt a ciphertext string.
 * Tries the current key first, then falls back to GATEWAZE_SECRETS_KEY_OLD.
 * Returns null if decryption fails with both keys.
 */
export function decryptSecret(ciphertext: string): string | null {
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    // Unknown version or plaintext — return null to signal decryption failure
    return null;
  }

  const encoded = ciphertext.slice(VERSION_PREFIX.length);
  const combined = Buffer.from(encoded, 'base64');

  if (combined.length < NONCE_LENGTH + TAG_LENGTH + 1) {
    return null;
  }

  const nonce = combined.subarray(0, NONCE_LENGTH);
  const tag = combined.subarray(combined.length - TAG_LENGTH);
  const encrypted = combined.subarray(NONCE_LENGTH, combined.length - TAG_LENGTH);

  // Try current key first
  const currentKey = getKey('GATEWAZE_SECRETS_KEY');
  if (currentKey) {
    const result = tryDecrypt(currentKey, nonce, encrypted, tag);
    if (result !== null) return result;
  }

  // Fall back to old key (rotation window)
  const oldKey = getKey('GATEWAZE_SECRETS_KEY_OLD');
  if (oldKey) {
    const result = tryDecrypt(oldKey, nonce, encrypted, tag);
    if (result !== null) return result;
  }

  return null;
}

function tryDecrypt(key: Buffer, nonce: Buffer, encrypted: Buffer, tag: Buffer): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Extract the last 4 characters of a plaintext value for display masking.
 */
export function getLast4(plaintext: string): string {
  if (plaintext.length <= 4) return plaintext;
  return plaintext.slice(-4);
}

/**
 * Mask a secret value for API display.
 * Returns "****<last4>" or "****" if last4 is not available.
 */
export function maskSecret(last4?: string | null): string {
  return last4 ? `****${last4}` : '****';
}

/**
 * Check if encryption is configured.
 */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/**
 * Seal the schema-declared secret fields of a module-config payload before it
 * is stored (PUT /api/modules/:id/config).
 *
 * Only fields whose ConfigField is `type: 'secret'` AND `encrypted: true` are
 * touched — the flag is the module's opt-in that its readers unseal. Values
 * already in the `v1:` envelope (a round-tripped form re-save) and non-string
 * or empty values pass through unchanged.
 *
 * Throws when a field needs sealing but GATEWAZE_SECRETS_KEY is not
 * configured: for an opted-in field, storing plaintext is never acceptable.
 */
export function sealSecretConfigFields(
  config: Record<string, unknown>,
  configSchema: Record<string, { type?: string; encrypted?: boolean } | undefined> | null | undefined,
): Record<string, unknown> {
  if (!configSchema) return config;
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(config)) {
    // Keys come from the request body: never treat prototype-walking names
    // as schema fields, and only honour the schema's OWN properties — both
    // guards close the js/remote-property-injection shape (a crafted key
    // like __proto__ matching Object.prototype members).
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const field = Object.prototype.hasOwnProperty.call(configSchema, key) ? configSchema[key] : undefined;
    if (!field || field.type !== 'secret' || field.encrypted !== true) continue;
    if (typeof value !== 'string' || value === '' || value.startsWith(VERSION_PREFIX)) continue;
    (out ??= { ...config })[key] = encryptSecret(value);
  }
  return out ?? config;
}
