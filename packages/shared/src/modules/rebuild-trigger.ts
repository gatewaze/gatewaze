/**
 * Rebuild trigger per spec-module-deployment-overhaul §7.
 *
 * The API process calls `triggerRebuild()` after install / apply-update /
 * uninstall. It bumps the `module_rebuild_counter` PostgreSQL sequence
 * (authoritative) and writes a sentinel file on the shared `modules/`
 * volume. Supervisors in the admin + portal containers watch the
 * sentinel and rebuild on change.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync, renameSync } from 'fs';
import { modulesRoot, rebuildSentinelFile, rebuildStatusFile } from './module-paths';

export type RebuildComponent = 'admin' | 'portal';

export interface RebuildSentinel {
  counter: number;
  components: RebuildComponent[];
  reason: string;
  requestedAt: string;
}

export interface RebuildStatus {
  counter: number;
  status: 'ok' | 'error';
  completedAt: string;
  error?: string | null;
  buildDurationMs?: number;
}

interface SupabaseLike {
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): unknown;
}

/**
 * Bump the rebuild counter + write the sentinel file. Returns the new
 * counter so the API handler can include it in the response and the UI
 * can poll `GET /api/modules/rebuild/:counter`.
 *
 * The sequence is the authoritative counter; the sentinel file is a
 * signalling channel to the in-container supervisors.
 */
export async function triggerRebuild(
  supabase: SupabaseLike,
  opts: { components?: RebuildComponent[]; reason: string }
): Promise<number> {
  const components = opts.components ?? ['admin', 'portal'];

  // Ask PostgreSQL for the next value of module_rebuild_counter. The
  // supabase-js RPC route requires an exec_sql-shaped function; fall
  // back to a direct query via PostgREST's rpc interface when a helper
  // RPC isn't available. We prefer a dedicated SQL function for RLS
  // clarity (defined below in a follow-up migration).
  let counter: number;
  const { data, error } = await supabase.rpc('module_rebuild_next');
  if (error || typeof data !== 'number') {
    // Fallback: monotonic clock-based counter. Still unique per request
    // but not cluster-wide; logs a warning so operators can diagnose
    // missing sequence/RPC.
    counter = Date.now();
    console.warn('[module-rebuild] Sequence RPC unavailable, using clock fallback:', error);
  } else {
    counter = data;
  }

  const sentinel: RebuildSentinel = {
    counter,
    components,
    reason: opts.reason,
    requestedAt: new Date().toISOString(),
  };

  mkdirSync(modulesRoot(), { recursive: true });

  // Write atomically via temp-rename so the supervisor's `chokidar`
  // watcher sees a consistent file content when it fires.
  const path = rebuildSentinelFile();
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(sentinel, null, 2));
  renameSync(tmp, path);

  // Dev shortcut: when admin/portal run in dev mode (Vite dev server
  // and Next dev server), HMR handles source changes directly from the
  // shared volume. There's no bundle rebuild — so stamp the status
  // files immediately so UI polling completes rather than timing out.
  if (process.env.DEV_AUTO_REBUILD_OK === '1') {
    const status: RebuildStatus = {
      counter,
      status: 'ok',
      completedAt: new Date().toISOString(),
      buildDurationMs: 0,
    };
    for (const c of components) {
      const f = rebuildStatusFile(c);
      writeFileSync(f + '.tmp', JSON.stringify(status, null, 2));
      renameSync(f + '.tmp', f);
    }
  }

  return counter;
}

/**
 * Read the latest rebuild status for a given component. Returns null if
 * the supervisor hasn't run yet (first boot) or if the file is absent.
 */
export function readRebuildStatus(component: RebuildComponent): RebuildStatus | null {
  const path = rebuildStatusFile(component);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RebuildStatus;
  } catch {
    return null;
  }
}

/**
 * Summary used by `GET /api/modules/rebuild/:counter` per spec §10.2.
 */
export function summariseRebuild(targetCounter: number): {
  counter: number;
  status: 'pending' | 'ok' | 'error';
  components: Record<RebuildComponent, { status: 'pending' | 'ok' | 'error'; completedAt?: string; error?: string | null }>;
} {
  const componentKeys: RebuildComponent[] = ['admin', 'portal'];
  const components = {} as Record<RebuildComponent, { status: 'pending' | 'ok' | 'error'; completedAt?: string; error?: string | null }>;
  let overall: 'pending' | 'ok' | 'error' = 'ok';
  let anyPending = false;

  for (const c of componentKeys) {
    const s = readRebuildStatus(c);
    if (!s || s.counter < targetCounter) {
      components[c] = { status: 'pending' };
      anyPending = true;
    } else {
      components[c] = { status: s.status, completedAt: s.completedAt, error: s.error };
      if (s.status === 'error') overall = 'error';
    }
  }

  if (anyPending && overall !== 'error') overall = 'pending';
  return { counter: targetCounter, status: overall, components };
}
