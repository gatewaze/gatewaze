import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMockSupabase } from '../../../test/mock-supabase.js';

const mockSupabase = createMockSupabase();
vi.mock('../supabase.js', () => ({
  getSupabase: () => mockSupabase.client,
  getServiceSupabase: () => mockSupabase.client,
}));

const {
  aliasedBucketStore,
  getStorageRegistry,
  resetStorageRegistryForTests,
  setStorageModuleDir,
  storageAliasActive,
  storageRegistryCandidates,
  StorageModuleUnavailableError,
} = await import('../storage-registry.js');

let tmp: string;
const savedAlias = process.env.STORAGE_SUPABASE_ALIAS;
const savedDataDir = process.env.GATEWAZE_DATA_DIR;

/** A fake modules/storage/lib/registry.js in its own directory. */
function fakeStorageModule(source: string, under = 'storage'): string {
  const dir = join(tmp, under);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'registry.js'), source);
  return dir;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gw-storage-registry-'));
  // Keep the real /var/lib/gatewaze out of the candidate list.
  process.env.GATEWAZE_DATA_DIR = join(tmp, 'data');
  delete process.env.STORAGE_SUPABASE_ALIAS;
  resetStorageRegistryForTests({ cacheRoots: [join(tmp, 'root', '.gatewaze-modules')] });
  mockSupabase.mockResult(null);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (savedAlias === undefined) delete process.env.STORAGE_SUPABASE_ALIAS;
  else process.env.STORAGE_SUPABASE_ALIAS = savedAlias;
  if (savedDataDir === undefined) delete process.env.GATEWAZE_DATA_DIR;
  else process.env.GATEWAZE_DATA_DIR = savedDataDir;
});

describe('storageRegistryCandidates', () => {
  it('tries the loader-resolved module first, then the live tree, then the clone cache', () => {
    const known = fakeStorageModule('export {}', 'known/storage');
    const live = fakeStorageModule('export {}', 'data/modules/storage');
    const cloned = fakeStorageModule('export {}', 'root/.gatewaze-modules/github-com-gatewaze-gatewaze-modules/modules/storage');
    setStorageModuleDir(known);
    expect(storageRegistryCandidates()).toEqual([
      resolve(known, 'lib', 'registry.js'),
      resolve(live, 'lib', 'registry.js'),
      resolve(cloned, 'lib', 'registry.js'),
    ]);
  });
});

describe('getStorageRegistry', () => {
  it('imports the module and creates one registry with the service-role client', async () => {
    const dir = fakeStorageModule(`
      export let created = 0;
      export function createStorageRegistry(deps) {
        created += 1;
        return { deps, bucketStore: async (b) => ({ bucket: b }) };
      }
    `);
    setStorageModuleDir(dir);
    const a = await getStorageRegistry();
    const b = await getStorageRegistry();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect((a as unknown as { deps: { supabase: unknown } }).deps.supabase).toBe(mockSupabase.client);
    const mod = (await import(pathToFileURL(join(dir, 'lib', 'registry.js')).href)) as { created: number };
    expect(mod.created).toBe(1);
  });

  it('returns null for a copy of the module without bucketStore', async () => {
    setStorageModuleDir(fakeStorageModule('export function createStorageRegistry() { return { storeForNew() {} }; }'));
    expect(await getStorageRegistry()).toBeNull();
  });

  it('returns null when the module is not on disk', async () => {
    setStorageModuleDir(join(tmp, 'missing'));
    expect(await getStorageRegistry()).toBeNull();
  });

  it('returns null when the module throws on import', async () => {
    setStorageModuleDir(fakeStorageModule('throw new Error("broken");'));
    expect(await getStorageRegistry()).toBeNull();
  });
});

describe('storageAliasActive', () => {
  it('follows env STORAGE_SUPABASE_ALIAS first', async () => {
    process.env.STORAGE_SUPABASE_ALIAS = 'r2';
    expect(await storageAliasActive()).toBe(true);
    process.env.STORAGE_SUPABASE_ALIAS = 'supabase';
    mockSupabase.mockResult({ config: { supabase_alias: 'r2' } });
    expect(await storageAliasActive()).toBe(false);
  });

  it('reads supabase_alias from the storage module config', async () => {
    mockSupabase.mockResult({ config: { supabase_alias: 'r2' } });
    expect(await storageAliasActive()).toBe(true);
  });

  it.each([
    ['no storage module row', null],
    ['no alias', { config: { default_provider: 'supabase', provider_media: 'r2' } }],
    ['alias supabase', { config: { supabase_alias: 'supabase' } }],
    ['blank alias', { config: { supabase_alias: '  ' } }],
  ])('is false with %s', async (_label, row) => {
    mockSupabase.mockResult(row);
    expect(await storageAliasActive()).toBe(false);
  });

  it('is false when the config cannot be read', async () => {
    mockSupabase.mockError('boom');
    expect(await storageAliasActive()).toBe(false);
  });
});

describe('aliasedBucketStore', () => {
  it('is null when the brand is not aliased', async () => {
    mockSupabase.mockResult(null);
    expect(await aliasedBucketStore('media')).toBeNull();
  });

  it('is the registry bucket store when aliased', async () => {
    process.env.STORAGE_SUPABASE_ALIAS = 'r2';
    setStorageModuleDir(fakeStorageModule('export function createStorageRegistry() { return { bucketStore: async (b) => ({ bucket: b, provider: "supabase" }) }; }'));
    expect(await aliasedBucketStore('event-images')).toEqual({ bucket: 'event-images', provider: 'supabase' });
  });

  it('throws instead of falling back to Supabase when aliased but the module is missing', async () => {
    process.env.STORAGE_SUPABASE_ALIAS = 'r2';
    setStorageModuleDir(join(tmp, 'missing'));
    await expect(aliasedBucketStore('media')).rejects.toBeInstanceOf(StorageModuleUnavailableError);
  });
});
