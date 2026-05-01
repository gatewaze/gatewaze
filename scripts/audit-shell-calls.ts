#!/usr/bin/env tsx
/**
 * Fails on any raw shell-exec call outside the safe-exec wrapper.
 *
 * Forbidden patterns:
 *   - child_process.exec(...)        — shell-string call
 *   - execSync(`...`)                — single-string argument (shell)
 *   - spawn(..., { shell: true })    — explicit shell escalation
 *
 * Allowed:
 *   - safeExec(...)                  — argv-array wrapper
 *   - execFileSync(name, [argv])     — argv-array form
 *   - spawn(name, [argv])            — argv-array form
 *
 * Run: pnpm exec tsx scripts/audit-shell-calls.ts
 *      (CI calls this as part of pr.yml in phase 2)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');

const SCAN_DIRS = [
  'packages/api/src',
  'packages/admin/src',
  'packages/portal',
  'packages/shared/src',
  'scripts',
];

const ALLOWLIST_FILES = new Set([
  // The wrapper itself necessarily references execFileSync.
  'packages/api/src/lib/safe-exec.ts',
  // The audit script itself contains the forbidden literals as patterns.
  'scripts/audit-shell-calls.ts',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__tests__',
]);

const PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: 'child_process.exec()',
    regex: /\bexec\s*\(\s*["'`]/,
  },
  {
    name: 'execSync(string)',
    regex: /\bexecSync\s*\(\s*[`"']/,
  },
  {
    name: 'spawn({ shell: true })',
    regex: /spawn\s*\([^)]*shell\s*:\s*true/,
  },
];

interface Hit {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

function walk(dir: string, hits: Hit[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, hits);
    } else if (st.isFile() && /\.(ts|tsx|js|cjs|mjs)$/.test(entry)) {
      const rel = relative(REPO_ROOT, full);
      if (ALLOWLIST_FILES.has(rel)) continue;
      const contents = readFileSync(full, 'utf8');
      const lines = contents.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments — quick heuristic; not a parser, but good enough.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        for (const p of PATTERNS) {
          if (p.regex.test(line)) {
            hits.push({ file: rel, line: i + 1, pattern: p.name, excerpt: line.trim() });
          }
        }
      }
    }
  }
}

function main(): void {
  const hits: Hit[] = [];
  for (const d of SCAN_DIRS) {
    const full = join(REPO_ROOT, d);
    try {
      walk(full, hits);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  if (hits.length === 0) {
    console.log('audit-shell-calls: clean (0 hits)');
    return;
  }

  console.error(`audit-shell-calls: ${hits.length} forbidden shell call(s) found:\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.pattern}]`);
    console.error(`    ${hit.excerpt}`);
  }
  console.error('\nReplace with safeExec() from packages/api/src/lib/safe-exec.ts,');
  console.error('or with execFileSync(binary, [argv]) / spawn(binary, [argv]) directly.');
  process.exit(1);
}

main();
