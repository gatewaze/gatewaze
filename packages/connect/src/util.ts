import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SERVER_URL = 'https://mcp.aaif.live/';

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
