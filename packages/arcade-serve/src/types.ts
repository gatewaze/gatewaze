import type { Readable } from 'node:stream';

export type GameStatus = 'draft' | 'published' | 'archived';

export interface ManifestFile {
  path: string;
  bytes?: number;
  sha256?: string;
  content_type?: string;
}

export interface Manifest {
  entry: string;
  files: ManifestFile[];
  total_bytes?: number;
}

export interface GameRecord {
  id: string;
  slug: string;
  status: GameStatus;
  liveVersionId: string | null;
  /** Raw jsonb — never trusted; re-validated at serve time (spec §6). */
  cspExceptions: unknown;
}

export interface VersionRecord {
  id: string;
  gameId: string;
  storagePrefix: string;
  manifest: Manifest;
}

/**
 * Read-only view of the arcade tables. Deliberately has no mutating method —
 * the whole service is SELECT-only (spec §13).
 */
export interface Catalog {
  /** Game + its live version, or null when the slug is unknown. */
  bySlug(slug: string): Promise<{ game: GameRecord; liveVersion: VersionRecord | null } | null>;
  /** Game + the named version, or null when either is unknown or unrelated. */
  byVersion(slug: string, versionId: string): Promise<{ game: GameRecord; version: VersionRecord } | null>;
  /** Cheap reachability probe for /readyz. */
  ping(): Promise<boolean>;
}

export interface StoredObject {
  stream: Readable;
  bytes: number | null;
}

export interface AssetStore {
  /** Reads one object by its full storage key; null when it does not exist. */
  read(key: string): Promise<StoredObject | null>;
}
