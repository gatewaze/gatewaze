import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import {
  encryptSecret,
  decryptSecret,
  sealSecretConfigFields,
} from '../secrets';

const KEY = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret round-trip', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GATEWAZE_SECRETS_KEY;
    process.env.GATEWAZE_SECRETS_KEY = KEY;
  });
  afterEach(() => {
    if (saved == null) delete process.env.GATEWAZE_SECRETS_KEY;
    else process.env.GATEWAZE_SECRETS_KEY = saved;
  });

  it('round-trips and produces the v1: envelope', () => {
    const sealed = encryptSecret('hunter2');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(decryptSecret(sealed)).toBe('hunter2');
  });

  it('throws on encrypt when no key is configured', () => {
    delete process.env.GATEWAZE_SECRETS_KEY;
    expect(() => encryptSecret('x')).toThrow(/GATEWAZE_SECRETS_KEY/);
  });
});

describe('sealSecretConfigFields', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GATEWAZE_SECRETS_KEY;
    process.env.GATEWAZE_SECRETS_KEY = KEY;
  });
  afterEach(() => {
    if (saved == null) delete process.env.GATEWAZE_SECRETS_KEY;
    else process.env.GATEWAZE_SECRETS_KEY = saved;
  });

  const schema = {
    provider: { type: 'select' },
    proxy_username: { type: 'secret', encrypted: true },
    proxy_password: { type: 'secret', encrypted: true },
    legacy_token: { type: 'secret' }, // secret but NOT opted in
  };

  it('seals only secret+encrypted fields; leaves everything else alone', () => {
    const out = sealSecretConfigFields(
      { provider: 'dataimpulse', proxy_username: 'u', proxy_password: 'p', legacy_token: 't', extra: 'x' },
      schema,
    );
    expect(out.provider).toBe('dataimpulse');
    expect(out.extra).toBe('x');
    expect(out.legacy_token).toBe('t'); // no opt-in → untouched
    expect(String(out.proxy_username).startsWith('v1:')).toBe(true);
    expect(String(out.proxy_password).startsWith('v1:')).toBe(true);
    expect(decryptSecret(out.proxy_username as string)).toBe('u');
    expect(decryptSecret(out.proxy_password as string)).toBe('p');
  });

  it('is round-trip safe: already-sealed values are not double-encrypted', () => {
    const sealed = encryptSecret('u');
    const out = sealSecretConfigFields({ proxy_username: sealed }, schema);
    expect(out.proxy_username).toBe(sealed);
  });

  it('passes empty and non-string values through', () => {
    const out = sealSecretConfigFields({ proxy_username: '', proxy_password: null }, schema);
    expect(out.proxy_username).toBe('');
    expect(out.proxy_password).toBeNull();
  });

  it('does not mutate the input object', () => {
    const input = { proxy_username: 'u' };
    const out = sealSecretConfigFields(input, schema);
    expect(input.proxy_username).toBe('u');
    expect(out).not.toBe(input);
  });

  it('returns the input untouched when there is no schema', () => {
    const input = { proxy_username: 'u' };
    expect(sealSecretConfigFields(input, null)).toBe(input);
    expect(sealSecretConfigFields(input, undefined)).toBe(input);
  });

  it('throws (fail closed) when a field needs sealing but no key is configured', () => {
    delete process.env.GATEWAZE_SECRETS_KEY;
    expect(() => sealSecretConfigFields({ proxy_password: 'p' }, schema)).toThrow(/GATEWAZE_SECRETS_KEY/);
  });
});
