import { spawnSync } from 'node:child_process';
import { findOnPath } from '../util.js';

export function claudeBinaryPath(): string | null {
  return findOnPath('claude');
}

/** The command we run (user scope, HTTP transport — Claude Code speaks remote MCP natively). */
export function claudeCodeAddCommand(name: string, serverUrl: string): string[] {
  return ['claude', 'mcp', 'add', '--scope', 'user', '--transport', 'http', name, serverUrl];
}

export function formatCommand(argv: string[]): string {
  return argv.map((a) => (/[^A-Za-z0-9_@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ');
}

export interface ClaudeCodeResult {
  ok: boolean;
  message: string;
  /** The exact command, for manual fallback. */
  command: string;
}

export function runClaudeCodeAdd(name: string, serverUrl: string): ClaudeCodeResult {
  const argv = claudeCodeAddCommand(name, serverUrl);
  const command = formatCommand(argv);
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  if (res.error) {
    return { ok: false, message: `Could not run claude: ${res.error.message}`, command };
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    return {
      ok: false,
      message: `claude mcp add exited with code ${res.status}${detail ? `: ${detail}` : ''}`,
      command,
    };
  }
  const out = (res.stdout || '').trim();
  return { ok: true, message: out || `Registered "${name}" with Claude Code (user scope).`, command };
}
