import { execFileSync, type ExecFileSyncOptions } from 'child_process';

const ALLOWED_BINARIES = new Set([
  'git',
  'pgbackrest',
  'pg_dump',
  'pg_restore',
]);

export interface SafeExecResult {
  stdout: string;
  stderr: string;
}

export class DisallowedBinaryError extends Error {
  constructor(public readonly binary: string) {
    super(`Binary "${binary}" is not in the safe-exec allowlist`);
    this.name = 'DisallowedBinaryError';
  }
}

/**
 * Synchronously executes a binary with an argv array. The binary must be in
 * the allowlist; argv is passed through `execFileSync`, which never invokes
 * a shell, so user/DB-controlled strings cannot be interpreted as shell
 * metacharacters.
 *
 * Use this anywhere a DB or user value flows into a child process. Do not
 * call `child_process.exec`, `execSync` with a single string argument, or
 * `spawn` with `shell: true` outside of this module — `scripts/audit-shell-
 * calls.ts` enforces that rule in CI.
 */
export function safeExec(
  binary: string,
  args: readonly string[],
  options: ExecFileSyncOptions = {},
): SafeExecResult {
  if (!ALLOWED_BINARIES.has(binary)) {
    throw new DisallowedBinaryError(binary);
  }
  const { encoding: _encoding, ...rest } = options;
  const stdout = execFileSync(binary, args as string[], {
    ...rest,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // execFileSync returns the captured stdout when stdio[1]='pipe' and
  // encoding is set. stderr is bubbled via thrown error on non-zero exit.
  return { stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'), stderr: '' };
}

/**
 * @internal — exposed for tests.
 */
export function _allowedBinaries(): ReadonlySet<string> {
  return ALLOWED_BINARIES;
}
