// Key handling for the BFF. ADMIN_BFF_SESSION_SECRET holds one or more
// 32-byte master keys (the first is current; the rest still decrypt, for
// rotation). Each use gets its own subkey derived with HKDF-SHA256, so a
// value encrypted for one purpose can never be decrypted as another: the
// session cookie, the flow cookie and the session records in Redis.
import crypto from 'node:crypto';

export type KeyPurpose = 'cookie:session' | 'cookie:flow' | 'store';

const INFO_PREFIX = 'gatewaze admin-bff v1 ';

// Derives one 32-byte subkey per master key, in the same order.
export function deriveKeys(masters: Buffer[], purpose: KeyPurpose): Buffer[] {
  return masters.map((m) => Buffer.from(crypto.hkdfSync('sha256', m, Buffer.alloc(0), INFO_PREFIX + purpose, 32)));
}

// Prefix of every sealed value.
export const SEALED_PREFIX = 'v1:';
const VERSION = SEALED_PREFIX;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// AES-256-GCM with the first key. `context` (the session ID) is bound as
// associated data, so a record copied under another session's key won't
// decrypt.
export function seal(keys: Buffer[], plaintext: string, context: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys[0], iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

// Tries each key in turn. Returns null when no key opens the value (wrong
// key, tampered, truncated, or not sealed at all).
export function open(keys: Buffer[], sealed: string, context: string): string | null {
  if (!sealed.startsWith(VERSION)) return null;
  const raw = Buffer.from(sealed.slice(VERSION.length), 'base64url');
  if (raw.length < IV_BYTES + TAG_BYTES) return null;
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Authentication failed with this key: try the next one.
    }
  }
  return null;
}
