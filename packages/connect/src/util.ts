import fs from 'node:fs';
import path from 'node:path';

// /auth = the authentication-REQUIRED alias: clients only launch their
// OAuth sign-in on a 401 challenge, and the connector's purpose is
// signed-in (tiered) access. Pass --server .../ for anonymous read-only.
export const DEFAULT_SERVER_URL = 'https://mcp.aaif.live/auth';

/**
 * Derive a short connector name from the server URL's hostname.
 * e.g. https://mcp.aaif.live/ -> "aaif", https://mcp.example.test/ -> "example".
 */
export function deriveName(serverUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(serverUrl).hostname;
  } catch {
    return 'gatewaze';
  }
  const generic = new Set(['mcp', 'www', 'api', 'connect']);
  const labels = hostname.split('.').filter(Boolean);
  const core = labels.find((l) => !generic.has(l.toLowerCase())) ?? labels[0] ?? 'gatewaze';
  const cleaned = core.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return cleaned || 'gatewaze';
}

/**
 * Ask the server for its brand-configured connector name (GET /brand.json
 * on the server origin, so it works for both the root and /auth URLs).
 * Returns null on any failure — callers fall back to deriveName().
 */
export async function fetchConnectorName(serverUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${origin}/brand.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { connector_name?: unknown };
    const name = typeof body.connector_name === 'string' ? body.connector_name.trim() : '';
    // Same charset as client config keys, but case is preserved ("AAIF").
    const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '');
    return cleaned || null;
  } catch {
    return null;
  }
}

export function validateServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid --server URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`--server must be an http(s) URL, got: ${raw}`);
  }
  return url.toString();
}

/** Timestamp suitable for backup file suffixes: YYYYMMDD-HHMMSS */
export function backupTimestamp(date: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** Copy `filePath` to `<filePath>.bak-<timestamp>` and return the backup path. */
export function backupFile(filePath: string, date: Date = new Date()): string {
  const backupPath = `${filePath}.bak-${backupTimestamp(date)}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

/** Locate an executable on PATH (cross-platform, no shelling out). */
export function findOnPath(binary: string): string | null {
  const pathVar = process.env.PATH ?? '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext.toLowerCase());
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()) {
          return candidate;
        }
      } catch {
        // keep looking
      }
    }
  }
  return null;
}
