/**
 * scripts/lib/storage-registry.js is what the legacy worker scripts
 * (event-image-service, event-content-image-service) use to decide between
 * Supabase Storage and the storage module. The scripts package has no test
 * runner of its own, so it is tested from here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ScriptsRegistry {
  storageRegistryCandidates(root?: string): string[];
  storageAliasActive(supabase: unknown): Promise<boolean>;
  aliasedBucketStore(supabase: unknown, bucket: string): Promise<unknown>;
  resetStorageRegistryForTests(): void;
}

const modPath = resolve(import.meta.dirname, '../../../../../scripts/lib/storage-registry.js');
const m = (await import(pathToFileURL(modPath).href)) as ScriptsRegistry;

/** A supabase stand-in whose installed_modules read returns `row`. */
function fakeSupabase(row: unknown, error: { message: string } | null = null) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => q };
}

let tmp: string;
const saved = { alias: process.env.STORAGE_SUPABASE_ALIAS, dataDir: process.env.GATEWAZE_DATA_DIR };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gw-scripts-storage-'));
  process.env.GATEWAZE_DATA_DIR = join(tmp, 'data');
  delete process.env.STORAGE_SUPABASE_ALIAS;
  m.resetStorageRegistryForTests();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of [['STORAGE_SUPABASE_ALIAS', saved.alias], ['GATEWAZE_DATA_DIR', saved.dataDir]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('scripts storage registry', () => {
  it('is not aliased without config, so the scripts keep using supabase.storage', async () => {
    expect(await m.storageAliasActive(fakeSupabase(null))).toBe(false);
    expect(await m.aliasedBucketStore(fakeSupabase({ config: {} }), 'media')).toBeNull();
  });

  it('is aliased from the storage module config or env', async () => {
    expect(await m.storageAliasActive(fakeSupabase({ config: { supabase_alias: 'r2' } }))).toBe(true);
    m.resetStorageRegistryForTests();
    process.env.STORAGE_SUPABASE_ALIAS = 'supabase';
    expect(await m.storageAliasActive(fakeSupabase({ config: { supabase_alias: 'r2' } }))).toBe(false);
  });

  it('treats an unreadable config as not aliased', async () => {
    expect(await m.storageAliasActive(fakeSupabase(null, { message: 'boom' }))).toBe(false);
  });

  it('loads bucketStore from the live module tree when aliased', async () => {
    const lib = join(tmp, 'data', 'modules', 'storage', 'lib');
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(lib, 'registry.js'), 'export function createStorageRegistry() { return { bucketStore: async (b) => ({ bucket: b }) }; }');
    process.env.STORAGE_SUPABASE_ALIAS = 'r2';
    expect(m.storageRegistryCandidates(join(tmp, 'root'))).toEqual([join(lib, 'registry.js')]);
    expect(await m.aliasedBucketStore(fakeSupabase(null), 'event-content-images')).toEqual({ bucket: 'event-content-images' });
  });
});
