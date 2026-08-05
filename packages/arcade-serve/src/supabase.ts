import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import { TtlCache } from './cache.js';
import type { ServeConfig } from './config.js';
import type { AssetStore, Catalog, GameRecord, GameStatus, Manifest, StoredObject, VersionRecord } from './types.js';

// READ-ONLY BY CONSTRUCTION.
//
// Every database call in this file is `.select()`, and the only storage call is
// `.download()`. There is no insert/update/upsert/delete/upload/remove path
// anywhere in this service — `src/__tests__/read-only.test.ts` asserts that
// mechanically over the whole `src/` tree, and the deployment should still hand
// this service a SELECT-only role (spec §13).

/* eslint-disable @typescript-eslint/no-explicit-any -- intentional Database/Schema generics; see .claude/rules/typescript-patterns.md */
type SupabaseAny = ReturnType<typeof createClient<any, any, any>>;

export function createReadOnlyClient(config: ServeConfig): SupabaseAny {
  return createClient<any, any, any>(config.supabaseUrl, config.supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const GAME_COLUMNS = 'id, slug, status, live_version_id, csp_exceptions';
const VERSION_COLUMNS = 'id, game_id, storage_prefix, manifest';

interface GameRow {
  id: string;
  slug: string;
  status: string;
  live_version_id: string | null;
  csp_exceptions: unknown;
}

interface VersionRow {
  id: string;
  game_id: string;
  storage_prefix: string;
  manifest: unknown;
}

const STATUSES: GameStatus[] = ['draft', 'published', 'archived'];

function toGame(row: GameRow): GameRecord | null {
  if (!row || typeof row.id !== 'string' || typeof row.slug !== 'string') return null;
  const status = STATUSES.includes(row.status as GameStatus) ? (row.status as GameStatus) : null;
  // An unrecognised status is treated as "not servable" rather than defaulted —
  // a future status value must never fall through to published behaviour.
  if (!status) return null;
  return {
    id: row.id,
    slug: row.slug,
    status,
    liveVersionId: row.live_version_id ?? null,
    cspExceptions: row.csp_exceptions ?? null,
  };
}

function toManifest(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as { entry?: unknown; files?: unknown; total_bytes?: unknown };
  if (typeof candidate.entry !== 'string' || candidate.entry.length === 0) return null;
  if (!Array.isArray(candidate.files)) return null;
  return {
    entry: candidate.entry,
    files: candidate.files as Manifest['files'],
    total_bytes: typeof candidate.total_bytes === 'number' ? candidate.total_bytes : undefined,
  };
}

function toVersion(row: VersionRow): VersionRecord | null {
  if (!row || typeof row.id !== 'string' || typeof row.storage_prefix !== 'string') return null;
  const manifest = toManifest(row.manifest);
  if (!manifest) return null;
  return { id: row.id, gameId: row.game_id, storagePrefix: row.storage_prefix, manifest };
}

type SlugEntry = { game: GameRecord; liveVersion: VersionRecord | null } | null;
type VersionEntry = { game: GameRecord; version: VersionRecord } | null;

export function createSupabaseCatalog(client: SupabaseAny, config: ServeConfig): Catalog {
  const slugCache = new TtlCache<SlugEntry>(config.cacheTtlMs);
  const versionCache = new TtlCache<VersionEntry>(config.cacheTtlMs);

  async function loadGame(slug: string): Promise<GameRecord | null> {
    const { data, error } = await client.from('arcade_games').select(GAME_COLUMNS).eq('slug', slug).maybeSingle();
    if (error) throw new Error(`arcade_games lookup failed: ${error.message}`);
    return data ? toGame(data as GameRow) : null;
  }

  async function loadVersion(gameId: string, versionId: string): Promise<VersionRecord | null> {
    // game_id is part of the predicate, so a version id belonging to another
    // game can never be served under this slug.
    const { data, error } = await client
      .from('arcade_game_versions')
      .select(VERSION_COLUMNS)
      .eq('id', versionId)
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) throw new Error(`arcade_game_versions lookup failed: ${error.message}`);
    return data ? toVersion(data as VersionRow) : null;
  }

  return {
    async bySlug(slug) {
      const cached = slugCache.get(slug);
      if (cached) return cached.value;

      const game = await loadGame(slug);
      let entry: SlugEntry = null;
      if (game) {
        const liveVersion = game.liveVersionId ? await loadVersion(game.id, game.liveVersionId) : null;
        entry = { game, liveVersion };
      }
      slugCache.set(slug, entry);
      return entry;
    },

    async byVersion(slug, versionId) {
      const key = `${slug}|${versionId}`;
      const cached = versionCache.get(key);
      if (cached) return cached.value;

      const game = await loadGame(slug);
      let entry: VersionEntry = null;
      if (game) {
        const version = await loadVersion(game.id, versionId);
        if (version) entry = { game, version };
      }
      versionCache.set(key, entry);
      return entry;
    },

    async ping() {
      const { error } = await client.from('arcade_games').select('id').limit(1);
      return !error;
    },
  };
}

export function createSupabaseAssetStore(client: SupabaseAny, config: ServeConfig): AssetStore {
  return {
    async read(key: string): Promise<StoredObject | null> {
      const { data, error } = await client.storage.from(config.storageBucket).download(key);
      if (error || !data) return null;
      const blob = data as Blob;
      // Blob.stream() is a web ReadableStream; Readable.fromWeb bridges it so the
      // object is piped to the socket instead of buffered in memory.
      const stream = Readable.fromWeb(blob.stream() as Parameters<typeof Readable.fromWeb>[0]);
      return { stream, bytes: typeof blob.size === 'number' ? blob.size : null };
    },
  };
}
