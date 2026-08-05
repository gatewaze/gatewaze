import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Spec §13 requires this service's database posture to be read-only. The
// deployment should hand it a SELECT-only role, and this test is the second of
// the three compensating controls: a mechanical check that no write path exists
// in the source at all. If a future change needs to write, it does not belong
// in Arcade Serve.

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Calls that have no read-only meaning anywhere in this codebase. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['postgrest insert', /\.insert\s*\(/],
  ['postgrest upsert', /\.upsert\s*\(/],
  ['postgrest rpc', /\.rpc\s*\(/],
  ['storage upload', /\.upload\s*\(/],
  ['storage remove', /\.remove\s*\(/],
  ['storage move', /\.move\s*\(/],
  ['storage copy', /\.copy\s*\(/],
  ['signed url minting', /createSignedUrl/],
  ['raw sql mutation', /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\s+(INTO|FROM|TABLE|SET)\b/i],
];

/**
 * `.update(` / `.delete(` also name ordinary Map methods, so they are checked
 * only inside a PostgREST/storage builder chain — anything hanging off a
 * `.from(...)` call.
 */
const CHAIN_MUTATORS = /\.(update|delete|insert|upsert)\s*\(/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('read-only posture', () => {
  const files = sourceFiles(SRC);

  it('scans the whole src tree', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    const offenders = files.filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('never chains a mutator off a supabase builder', () => {
    // `Buffer.from` / `Readable.from` are not query builders.
    const notBuilders = new Set(['Buffer', 'Readable', 'Array', 'Object', 'String', 'Uint8Array', 'Set', 'Map', 'Promise']);
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\.from\s*\(/g)) {
        if (notBuilders.has(match[1])) continue;
        const chain = source.slice(match.index ?? 0, (match.index ?? 0) + 400);
        if (CHAIN_MUTATORS.test(chain)) offenders.push(`${file} (${match[1]}.from)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never receives the arcade token secret', () => {
    // ARCADE_TOKEN_SECRET belongs to the module API only (spec §13).
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('ARCADE_TOKEN_SECRET'));
    expect(offenders).toEqual([]);
  });

  it('never sets a cookie on this origin', () => {
    const offenders = files.filter((file) => /set-cookie/i.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('never emits Service-Worker-Allowed', () => {
    // Games share this origin, so a Service Worker is the sharpest form of the
    // cross-game risk: it intercepts every request in its scope. Scope is capped
    // at the path the script was served from — i.e. one immutable version
    // directory — and this header is the ONLY way to widen it. Serving-contract
    // invariant (spec §6), not a preference.
    const offenders = files.filter((file) =>
      /service-worker-allowed/i.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
