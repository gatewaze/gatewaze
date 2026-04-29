/**
 * Migration SQL linter.
 * Checks migration files for SQL statements that cannot safely
 * run inside a transaction (SAVEPOINT semantics).
 *
 * This is a best-effort regex denylist. Full SQL parsing deferred to v1.2.
 *
 * IMPORTANT: PL/pgSQL function bodies (DO $$ BEGIN ... END $$) use BEGIN/END
 * as block delimiters, NOT as transaction control. We strip these blocks
 * before applying the denylist to avoid false positives.
 */

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bBEGIN\s*;/i, reason: 'Module migrations must not contain top-level BEGIN; the runner owns transaction boundaries' },
  { pattern: /\bBEGIN\s+TRANSACTION\b/i, reason: 'Module migrations must not contain BEGIN TRANSACTION; the runner owns transaction boundaries' },
  { pattern: /\bBEGIN\s+WORK\b/i, reason: 'Module migrations must not contain BEGIN WORK; the runner owns transaction boundaries' },
  { pattern: /\bCOMMIT\s*;/i, reason: 'Module migrations must not contain COMMIT; the runner owns transaction boundaries' },
  { pattern: /\bROLLBACK\s*;/i, reason: 'Module migrations must not contain ROLLBACK; the runner owns transaction boundaries' },
  { pattern: /\bCREATE\s+DATABASE\b/i, reason: 'Module migrations must not create databases' },
  { pattern: /\bDROP\s+DATABASE\b/i, reason: 'Module migrations must not drop databases' },
  { pattern: /\bCREATE\s+TABLESPACE\b/i, reason: 'Module migrations must not manage tablespaces' },
  { pattern: /\bDROP\s+TABLESPACE\b/i, reason: 'Module migrations must not manage tablespaces' },
  { pattern: /\bALTER\s+SYSTEM\b/i, reason: 'Module migrations must not alter system configuration' },
  { pattern: /\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i, reason: 'CREATE INDEX CONCURRENTLY cannot run inside a transaction' },
  { pattern: /\bVACUUM\b/i, reason: 'VACUUM cannot run inside a transaction' },
  { pattern: /\bCOPY\s+.*\bPROGRAM\b/i, reason: 'COPY ... PROGRAM is not allowed in module migrations' },
  // Spec §5.9 expand/contract — destructive single-release DDL is forbidden
  // because it breaks single-release rollback. Drop columns / type
  // changes must ship in their own release after a coexist release.
  {
    pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/i,
    reason: 'DROP COLUMN must follow expand/contract: ship the read-fallback in release N, drop in N+1 (spec §5.9). Wrap with a feature flag if you need the migration to be no-op on N.',
  },
  {
    pattern: /\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+TYPE\b/i,
    reason: 'ALTER COLUMN ... TYPE must follow expand/contract: add a new column in release N, backfill, switch reads, drop the old column in N+1 (spec §5.9).',
  },
  {
    pattern: /\bALTER\s+TABLE\s+\S+\s+RENAME\s+COLUMN\b/i,
    reason: 'RENAME COLUMN breaks single-release rollback. Add the new column, dual-write, switch reads, drop the old column across two releases (spec §5.9).',
  },
];

export interface MigrationLintResult {
  filename: string;
  violations: Array<{
    pattern: string;
    reason: string;
    line?: number;
  }>;
}

/**
 * Strip PL/pgSQL blocks from SQL to avoid false positives.
 * Removes content between dollar-quoted strings ($$ ... $$, $body$ ... $body$, etc.)
 * and DO blocks, since BEGIN/END inside these are PL/pgSQL block delimiters,
 * not transaction control statements.
 */
function stripPlpgsqlBlocks(sql: string): string {
  // Remove dollar-quoted strings ($$...$$, $body$...$body$, $func$...$func$, etc.)
  // These contain PL/pgSQL code where BEGIN/END are block delimiters
  return sql.replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, '');
}

/**
 * Lint a single migration SQL string for forbidden patterns.
 * Returns violations found. Empty array means the migration is safe.
 */
export function lintMigrationSql(filename: string, sql: string): MigrationLintResult {
  const violations: MigrationLintResult['violations'] = [];

  // Strip SQL comments and PL/pgSQL blocks to reduce false positives
  const stripped = sql
    .replace(/--[^\n]*/g, '')          // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // multi-line comments

  // Further strip dollar-quoted PL/pgSQL blocks (DO $$...$$, CREATE FUNCTION $$...$$)
  const withoutPlpgsql = stripPlpgsqlBlocks(stripped);

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(withoutPlpgsql)) {
      // Find the line number of the first match in the original SQL for reporting
      const lines = sql.split('\n');
      let lineNum: number | undefined;
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          lineNum = i + 1;
          break;
        }
      }
      violations.push({
        pattern: pattern.source,
        reason,
        line: lineNum,
      });
    }
  }

  return { filename, violations };
}

/**
 * Check if a migration has any violations.
 */
export function hasMigrationViolations(result: MigrationLintResult): boolean {
  return result.violations.length > 0;
}
