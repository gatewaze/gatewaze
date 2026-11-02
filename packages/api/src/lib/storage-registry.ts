/**
 * The storage module's registry (gatewaze-modules modules/storage), loaded
 * at runtime.
 *
 * A brand that has moved off Supabase Storage sets the storage module's
 * config `supabase_alias` (or env STORAGE_SUPABASE_ALIAS). The registry's
 * bucketStore(bucket) then serves every Supabase bucket from that provider
 * (R2 on autodb and tech.tickets), `media` at the root and every other bucket
 * under `<bucket>/`.
 *
 * The module is imported from disk, not from a package, because the live
 * module tree only holds what a brand installed. A brand without the module
 * (or still on an older copy of it) gets null and keeps writing to Supabase
 * exactly as before.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modulesRoot } from '@gatewaze/shared/modules';
// SERVICE-ROLE OK: the registry writes to storage and reads the storage
// module's installed_modules row; both need the service role. Every route
// that reaches it authorises the caller first (routes/storage.ts, avatars).
import { getServiceSupabase } from './supabase.js';
import { logger } from './logger.js';

/** The parts of modules/storage's ObjectStore the platform uses. */
export interface PlatformObjectStore {
  readonly provider: string;
  readonly bucket: string;
  publicUrl(path: string): string;
  put(path: string, body: Buffer | Uint8Array, opts: { contentType: string; cacheControl?: string; upsert?: boolean }): Promise<{ bytes: number }>;
  signUpload(path: string, opts: { contentType: string; bytes?: number; expiresSeconds?: number }): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;
  head(path: string): Promise<{ ok: boolean; bytes: number; contentType: string }>;
  remove(paths: string[]): Promise<{ failed: string[] }>;
  list(prefix: string, max?: number): Promise<Array<{ path: string; bytes: number }>>;
}

/** The parts of modules/storage's StorageRegistry the platform uses. */
export interface PlatformStorageRegistry {
  bucketStore(bucket: string): Promise<PlatformObjectStore>;
}

type CreateRegistry = (deps: {
  supabase: unknown;
  logger: { warn(msg: string, meta?: Record<string, unknown>): void };
}) => PlatformStorageRegistry;

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const RETRY_AFTER_MS = 60_000;
const CONFIG_TTL_MS = 60_000;

const DEFAULT_CACHE_ROOTS = [resolve(PROJECT_ROOT, '.gatewaze-modules'), '/tmp/module-repos'];

let knownModuleDir: string | null = null;
let cacheRoots = DEFAULT_CACHE_ROOTS;
let registry: PlatformStorageRegistry | null = null;
let loading: Promise<PlatformStorageRegistry | null> | null = null;
let lastFailureAt = 0;
let aliasCache: { at: number; value: boolean } | null = null;

/**
 * The directory the module loader resolved `storage` to. Tried first, so the
 * registry is the same copy of the module the rest of the process runs.
 */
export function setStorageModuleDir(dir: string | null | undefined): void {
  knownModuleDir = dir ? resolve(dir) : null;
}

function registryFiles(moduleDir: string): string[] {
  return ['ts', 'js']
    .map((ext) => resolve(moduleDir, 'lib', `registry.${ext}`))
    .filter((p) => existsSync(p));
}

/** Every modules/storage/lib/registry file on disk, best first. */
export function storageRegistryCandidates(roots: string[] = cacheRoots): string[] {
  const out: string[] = [];
  const add = (paths: string[]) => {
    for (const p of paths) if (!out.includes(p)) out.push(p);
  };
  try {
    if (knownModuleDir) add(registryFiles(knownModuleDir));
    // The live serving tree (install/apply-update swaps it).
    add(registryFiles(resolve(modulesRoot(), 'storage')));
    // The loader's git clone cache, and the entrypoint's clones.
    for (const cacheRoot of roots) {
      if (!existsSync(cacheRoot)) continue;
      for (const ent of readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        add(registryFiles(resolve(cacheRoot, ent.name, 'modules', 'storage')));
      }
    }
  } catch {
    // best effort: whatever was found so far is still tried
  }
  return out;
}

async function load(): Promise<PlatformStorageRegistry | null> {
  const moduleLogger = {
    warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(meta ?? {}, msg),
  };
  for (const candidate of storageRegistryCandidates()) {
    try {
      const mod = (await import(pathToFileURL(candidate).href)) as { createStorageRegistry?: CreateRegistry };
      if (typeof mod.createStorageRegistry !== 'function') continue;
      const reg = mod.createStorageRegistry({ supabase: getServiceSupabase(), logger: moduleLogger });
      if (typeof reg?.bucketStore !== 'function') {
        // A copy of the module from before supabase_alias existed.
        logger.warn({ candidate }, '[storage] storage module has no bucketStore; it is too old to serve aliased buckets');
        continue;
      }
      return reg;
    } catch (err) {
      logger.warn({ candidate, err: err instanceof Error ? err.message : String(err) }, '[storage] could not load the storage module');
    }
  }
  return null;
}

/**
 * The process's one storage registry, or null when the storage module cannot
 * be loaded here. A miss is retried after a minute, so a module installed
 * while the process runs is picked up.
 */
export async function getStorageRegistry(): Promise<PlatformStorageRegistry | null> {
  if (registry) return registry;
  if (!loading) {
    if (lastFailureAt && Date.now() - lastFailureAt < RETRY_AFTER_MS) return null;
    loading = load().then(
      (r) => {
        registry = r;
        if (!r) lastFailureAt = Date.now();
        loading = null;
        return r;
      },
      () => {
        lastFailureAt = Date.now();
        loading = null;
        return null;
      },
    );
  }
  return loading;
}

/**
 * True when this brand serves its Supabase buckets from another provider:
 * env STORAGE_SUPABASE_ALIAS names a provider other than supabase, or (when
 * the env var is unset) the storage module's config has `supabase_alias`.
 * Same precedence as the registry. A failed config read counts as "not
 * aliased", which is also what the registry does.
 */
export async function storageAliasActive(): Promise<boolean> {
  const fromEnv = String(process.env.STORAGE_SUPABASE_ALIAS ?? '').trim();
  if (fromEnv) return fromEnv !== 'supabase';
  if (aliasCache && Date.now() - aliasCache.at < CONFIG_TTL_MS) return aliasCache.value;
  let value = false;
  try {
    // SERVICE-ROLE OK: reads the storage module's own config row only.
    const { data, error } = await getServiceSupabase()
      .from('installed_modules')
      .select('config')
      .eq('id', 'storage')
      .maybeSingle<{ config: Record<string, unknown> | null }>();
    if (error) throw new Error(error.message);
    const alias = data?.config?.['supabase_alias'];
    value = typeof alias === 'string' && alias.trim() !== '' && alias.trim() !== 'supabase';
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[storage] could not read the storage module config; treating storage as Supabase');
  }
  aliasCache = { at: Date.now(), value };
  return value;
}

export class StorageModuleUnavailableError extends Error {
  constructor() {
    super('storage is served from another provider, but the storage module cannot be loaded here');
    this.name = 'StorageModuleUnavailableError';
  }
}

/**
 * The aliased store for a Supabase bucket, or null when the brand is still on
 * Supabase Storage and the caller should use supabase.storage as before.
 * Throws when the brand is aliased but the module cannot be loaded, rather
 * than quietly writing to Supabase again.
 */
export async function aliasedBucketStore(bucket: string): Promise<PlatformObjectStore | null> {
  if (!(await storageAliasActive())) return null;
  const reg = await getStorageRegistry();
  if (!reg) throw new StorageModuleUnavailableError();
  return reg.bucketStore(bucket);
}

/** For tests: forget everything, and look only in these clone caches. */
export function resetStorageRegistryForTests(opts: { cacheRoots?: string[] } = {}): void {
  cacheRoots = opts.cacheRoots ?? DEFAULT_CACHE_ROOTS;
  knownModuleDir = null;
  registry = null;
  loading = null;
  lastFailureAt = 0;
  aliasCache = null;
}
