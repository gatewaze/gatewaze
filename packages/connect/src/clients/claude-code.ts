import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApplyOptions, ApplyResult } from '../types.js';
import { backupFile, deepEqual, findOnPath } from '../util.js';

export function claudeBinaryPath(): string | null {
  const onPath = findOnPath('claude');
  if (onPath) return onPath;
  // The native installer's location, for shells whose PATH doesn't have it.
  const native = path.join(
    os.homedir(),
    '.local',
    'bin',
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  );
  try {
    fs.accessSync(native);
    return native;
  } catch {
    return null;
  }
}

/** Claude Code's user-scope config — shared by the CLI and the VS Code extension. */
export function claudeUserConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/**
 * Signs of a Claude Code installation that don't require the binary on PATH —
 * the VS Code extension bundles its own binary but reads ~/.claude.json.
 */
export function claudeSettingsPresent(): boolean {
  return fs.existsSync(claudeUserConfigPath()) || fs.existsSync(path.join(os.homedir(), '.claude'));
}

/**
 * Register the server by writing user-scope mcpServers into ~/.claude.json
 * directly — the same entry `claude mcp add --scope user --transport http`
 * creates. Used when the binary can't be run (VS Code extension installs,
 * PATH-less Windows shells). Preserves all other content; backs up first.
 */
export function applyClaudeUserConfig(
  configPath: string,
  name: string,
  serverUrl: string,
  opts: ApplyOptions = {},
): ApplyResult {
  const desired = { type: 'http', url: serverUrl };

  let config: Record<string, unknown> = {};
  const exists = fs.existsSync(configPath);
  if (exists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8') || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'error', message: `${configPath} does not contain a JSON object; refusing to modify it.` };
      }
      config = parsed as Record<string, unknown>;
    } catch (err) {
      return { status: 'error', message: `${configPath} is not valid JSON (${(err as Error).message}); refusing to modify it.` };
    }
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const existing = servers[name];
  if (existing !== undefined && deepEqual(existing, desired)) {
    return { status: 'unchanged', message: `mcpServers.${name} already up to date in ${configPath}` };
  }
  if (existing !== undefined && !opts.overwrite) {
    return { status: 'conflict', message: `mcpServers.${name} already exists in ${configPath} with different settings` };
  }
  if (opts.dryRun) {
    return { status: existing === undefined ? 'added' : 'updated', message: `Would set mcpServers.${name} in ${configPath} (dry-run)` };
  }

  let backupPath: string | undefined;
  if (exists) backupPath = backupFile(configPath);
  servers[name] = desired;
  config.mcpServers = servers;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return {
    status: existing === undefined ? 'added' : 'updated',
    message: `${existing === undefined ? 'Added' : 'Updated'} mcpServers.${name} in ${configPath}`,
    backupPath,
  };
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

export function runClaudeCodeAdd(name: string, serverUrl: string, bin?: string): ClaudeCodeResult {
  const argv = claudeCodeAddCommand(name, serverUrl);
  const command = formatCommand(argv);
  // Windows: npm installs expose claude as a .cmd shim, which spawnSync
  // cannot exec directly (ENOENT) — route through a shell there.
  const useShell = process.platform === 'win32';
  const exe = bin ?? argv[0];
  const res = spawnSync(useShell && exe.includes(' ') ? `"${exe}"` : exe, argv.slice(1), {
    encoding: 'utf8',
    timeout: 30_000,
    shell: useShell,
  });
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
