/**
 * Per-registration endpoint allowlist. The generic api-mcp is only as safe as
 * this list: it refuses any call whose METHOD + path does not match an entry.
 * One MCP-server registration carries one allowlist (via GATEWAZE_API_ALLOWED),
 * so the same package can be registered per use-case with a different scope.
 *
 * Entry format: "METHOD /path/pattern", comma- or newline-separated.
 * Path patterns support ":param" segments which match a single non-slash
 * segment. Example:
 *   GET /api/admin/events/luma-syncable
 *   PATCH /api/events/:id
 */

const VALID_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

export interface AllowEntry {
  method: string;
  regex: RegExp;
  raw: string;
}

function escapeSegment(seg: string): string {
  return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseAllowlist(raw: string): AllowEntry[] {
  const entries: AllowEntry[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`Invalid allowlist entry (expected "METHOD /path"): ${trimmed}`);
    }
    const method = parts[0].toUpperCase();
    const pattern = parts[1];
    if (!VALID_METHODS.has(method)) {
      throw new Error(`Invalid method in allowlist entry: ${trimmed}`);
    }
    if (!pattern.startsWith('/')) {
      throw new Error(`Allowlist path must start with '/': ${trimmed}`);
    }
    const body = pattern
      .split('/')
      .map((seg) => (seg.startsWith(':') ? '[^/]+' : escapeSegment(seg)))
      .join('/');
    entries.push({ method, regex: new RegExp(`^${body}$`), raw: trimmed });
  }
  return entries;
}

export interface AllowResult {
  ok: boolean;
  reason?: string;
}

/**
 * Decide whether a method+path is permitted. Rejects bad input (traversal,
 * missing leading slash, query in path, unknown method) before matching.
 */
export function isAllowed(entries: AllowEntry[], method: string, path: string): AllowResult {
  const m = method.toUpperCase();
  if (!VALID_METHODS.has(m)) return { ok: false, reason: `method '${method}' not permitted` };
  if (!path.startsWith('/')) return { ok: false, reason: "path must start with '/'" };
  if (path.includes('?')) return { ok: false, reason: 'path must not include a query string (use the query argument)' };
  if (path.includes('..')) return { ok: false, reason: "path must not contain '..'" };
  const match = entries.some((e) => e.method === m && e.regex.test(path));
  if (!match) return { ok: false, reason: `${m} ${path} is not in this server's allowlist` };
  return { ok: true };
}
