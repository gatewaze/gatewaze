/**
 * The storage module's registry for the legacy worker scripts.
 *
 * Same job as packages/api/src/lib/storage-registry.ts, which the worker
 * image does not ship. A brand that serves its Supabase buckets from another
 * provider (storage module config `supabase_alias`, or env
 * STORAGE_SUPABASE_ALIAS) gets the registry's bucketStore(bucket) for writes;
 * every other brand gets null and keeps calling supabase.storage as before.
 *
 * Node built-ins only, so it loads wherever the scripts run.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RETRY_AFTER_MS = 60_000;
const CONFIG_TTL_MS = 60_000;

let registry = null;
let loading = null;
let lastFailureAt = 0;
let aliasCache = null;

function registryFiles(moduleDir) {
  return ['ts', 'js']
    .map((ext) => resolve(moduleDir, 'lib', `registry.${ext}`))
    .filter((p) => existsSync(p));
}

/** Every modules/storage/lib/registry file on disk, best first. */
export function storageRegistryCandidates(root = ROOT) {
  const out = [];
  const add = (paths) => {
    for (const p of paths) if (!out.includes(p)) out.push(p);
  };
  try {
    const dataDir = process.env.GATEWAZE_DATA_DIR || '/var/lib/gatewaze';
    add(registryFiles(resolve(dataDir, 'modules', 'storage')));
    for (const cacheRoot of [resolve(root, '.gatewaze-modules'), '/tmp/module-repos']) {
      if (!existsSync(cacheRoot)) continue;
      for (const ent of readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        add(registryFiles(resolve(cacheRoot, ent.name, 'modules', 'storage')));
      }
    }
  } catch {
    // best effort
  }
  return out;
}

async function load(supabase) {
  for (const candidate of storageRegistryCandidates()) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod.createStorageRegistry !== 'function') continue;
      const reg = mod.createStorageRegistry({
        supabase,
        logger: { warn: (msg, meta) => console.warn(msg, meta ?? '') },
      });
      if (typeof reg?.bucketStore === 'function') return reg;
      console.warn(`[storage] ${candidate} has no bucketStore; it is too old to serve aliased buckets`);
    } catch (err) {
      console.warn(`[storage] could not load ${candidate}: ${err?.message ?? err}`);
    }
  }
  return null;
}

/** One registry per process, or null when the storage module cannot be loaded. */
export async function getStorageRegistry(supabase) {
  if (registry) return registry;
  if (!loading) {
    if (lastFailureAt && Date.now() - lastFailureAt < RETRY_AFTER_MS) return null;
    loading = load(supabase).then(
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

/** True when the brand serves its Supabase buckets from another provider. */
export async function storageAliasActive(supabase) {
  const fromEnv = String(process.env.STORAGE_SUPABASE_ALIAS ?? '').trim();
  if (fromEnv) return fromEnv !== 'supabase';
  if (aliasCache && Date.now() - aliasCache.at < CONFIG_TTL_MS) return aliasCache.value;
  let value = false;
  try {
    const { data, error } = await supabase
      .from('installed_modules')
      .select('config')
      .eq('id', 'storage')
      .maybeSingle();
    if (error) throw new Error(error.message);
    const alias = data?.config?.supabase_alias;
    value = typeof alias === 'string' && alias.trim() !== '' && alias.trim() !== 'supabase';
  } catch (err) {
    // Never cache a failure. A brand with STORAGE_PUBLIC_URL keeps treating
    // its files as moved, so nothing quietly goes back to Supabase.
    const moved = String(process.env.STORAGE_PUBLIC_URL ?? '').trim() !== '';
    console.warn(`[storage] could not read the storage module config; treating storage as ${moved ? 'moved' : 'Supabase'}: ${err?.message ?? err}`);
    return aliasCache?.value ?? moved;
  }
  aliasCache = { at: Date.now(), value };
  return value;
}

/**
 * The aliased store for a Supabase bucket, or null when the brand is still on
 * Supabase Storage. Throws when the brand is aliased but the storage module
 * cannot be loaded, rather than quietly writing to Supabase again.
 */
export async function aliasedBucketStore(supabase, bucket) {
  if (!(await storageAliasActive(supabase))) return null;
  const reg = await getStorageRegistry(supabase);
  if (!reg) throw new Error('storage is served from another provider, but the storage module cannot be loaded here');
  return reg.bucketStore(bucket);
}

/** For tests. */
export function resetStorageRegistryForTests() {
  registry = null;
  loading = null;
  lastFailureAt = 0;
  aliasCache = null;
}
