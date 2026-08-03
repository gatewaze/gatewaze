import { Readable } from 'node:stream';
import type { ServeConfig } from '../config.js';
import type { AssetStore, Catalog, GameRecord, GameStatus, Manifest, VersionRecord } from '../types.js';

export const PORTAL_ORIGIN = 'https://aaif.dev';
export const PLAY_ORIGIN = 'https://play.aaif.dev';
export const SECRET = 'test-preview-secret-current';
export const PREVIOUS_SECRET = 'test-preview-secret-previous';

export const LIVE_VERSION_ID = '11111111-2222-4333-8444-555555555555';
export const DRAFT_VERSION_ID = '99999999-8888-4777-8666-555555555555';

export function testConfig(overrides: Partial<ServeConfig> = {}): ServeConfig {
  return {
    port: 0,
    playOrigin: PLAY_ORIGIN,
    portalOrigin: PORTAL_ORIGIN,
    previewSecrets: [SECRET, PREVIOUS_SECRET],
    storageBucket: 'arcade',
    supabaseUrl: 'http://supabase.invalid',
    supabaseKey: 'test-key',
    cacheTtlMs: 5000,
    strictHost: false,
    ...overrides,
  };
}

export function manifest(): Manifest {
  return {
    entry: 'index.html',
    total_bytes: 40,
    files: [
      { path: 'index.html', bytes: 22, content_type: 'text/html' },
      { path: 'questions.js', bytes: 10, content_type: 'text/javascript' },
      { path: 'img/logo.png', bytes: 8, content_type: 'image/png' },
      { path: 'notes.bin', bytes: 3, content_type: 'application/octet-stream' },
      { path: 'missing.js', bytes: 3, content_type: 'text/javascript' },
    ],
  };
}

export function game(status: GameStatus, cspExceptions: unknown = null): GameRecord {
  return {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    slug: 'mcp-quest',
    status,
    liveVersionId: LIVE_VERSION_ID,
    cspExceptions,
  };
}

export function version(id = LIVE_VERSION_ID): VersionRecord {
  return {
    id,
    gameId: game('published').id,
    storagePrefix: `games/${game('published').id}/${id}/`,
    manifest: manifest(),
  };
}

/** Storage that also holds an object NOT listed in the manifest. */
export const STORAGE_OBJECTS: Record<string, string> = {
  'index.html': '<!doctype html>hi',
  'questions.js': 'export{}',
  'img/logo.png': 'PNGBYTES',
  'notes.bin': 'raw',
  'secrets.env': 'SUPER_SECRET=1',
};

export function fakeAssets(): AssetStore & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(key: string) {
      reads.push(key);
      const suffix = key.slice(key.lastIndexOf('/', key.length) + 1);
      // Match on the repo-relative tail after the version prefix.
      const relative = key.replace(/^games\/[^/]+\/[^/]+\//, '');
      const body = STORAGE_OBJECTS[relative] ?? (suffix in STORAGE_OBJECTS ? STORAGE_OBJECTS[suffix] : undefined);
      if (body === undefined) return null;
      return { stream: Readable.from([Buffer.from(body, 'utf8')]), bytes: Buffer.byteLength(body) };
    },
  };
}

export interface FakeCatalogOptions {
  status?: GameStatus;
  liveVersionId?: string | null;
  cspExceptions?: unknown;
  extraVersions?: string[];
}

export function fakeCatalog(options: FakeCatalogOptions = {}): Catalog {
  const status = options.status ?? 'published';
  const record = game(status, options.cspExceptions ?? null);
  if (options.liveVersionId !== undefined) record.liveVersionId = options.liveVersionId;
  const known = new Set([LIVE_VERSION_ID, ...(options.extraVersions ?? [DRAFT_VERSION_ID])]);

  return {
    async bySlug(slug) {
      if (slug !== record.slug) return null;
      return {
        game: record,
        liveVersion: record.liveVersionId ? version(record.liveVersionId) : null,
      };
    },
    async byVersion(slug, versionId) {
      if (slug !== record.slug || !known.has(versionId)) return null;
      return { game: record, version: version(versionId) };
    },
    async ping() {
      return true;
    },
  };
}
