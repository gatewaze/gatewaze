import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApplyOptions, ApplyResult } from '../types.js';
import { backupFile, deepEqual, ensureParentDir } from '../util.js';

/** Platform-specific location of claude_desktop_config.json. */
export function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'Claude', 'claude_desktop_config.json');
}

/**
 * The entry we write. Claude Desktop's config cannot take a bare remote URL,
 * so we go through mcp-remote, which drives the OAuth sign-in in the browser.
 */
export function desktopServerEntry(serverUrl: string): { command: string; args: string[] } {
  return { command: 'npx', args: ['-y', 'mcp-remote', serverUrl] };
}

/**
 * Add (or update) an mcpServers entry in claude_desktop_config.json.
 * All existing JSON content is preserved; the file is backed up before writing.
 */
export function applyClaudeDesktopConfig(
  configPath: string,
  name: string,
  serverUrl: string,
  opts: ApplyOptions = {}
): ApplyResult {
  const desired = desktopServerEntry(serverUrl);

  let config: Record<string, unknown> = {};
  const exists = fs.existsSync(configPath);
  if (exists) {
    const raw = fs.readFileSync(configPath, 'utf8');
    if (raw.trim() !== '') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return {
            status: 'error',
            message: `${configPath} does not contain a JSON object; refusing to modify it.`,
          };
        }
        config = parsed as Record<string, unknown>;
      } catch (err) {
        return {
          status: 'error',
          message: `Could not parse ${configPath} (${(err as Error).message}); refusing to modify it.`,
        };
      }
    }
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return {
      status: 'error',
      message: `"mcpServers" in ${configPath} is not an object; refusing to modify it.`,
    };
  }

  const existing = servers[name];
  const isUpdate = existing !== undefined;
  if (isUpdate && deepEqual(existing, desired)) {
    return { status: 'unchanged', message: `"${name}" is already configured for this server.` };
  }
  if (isUpdate && !opts.overwrite && !opts.dryRun) {
    return {
      status: 'conflict',
      message:
        `An mcpServers entry named "${name}" already exists in ${configPath} with different settings ` +
        `(currently: ${JSON.stringify(existing)}).`,
    };
  }

  servers[name] = desired;
  config.mcpServers = servers;
  const output = JSON.stringify(config, null, 2) + '\n';

  if (opts.dryRun) {
    return {
      status: isUpdate ? 'would-update' : 'would-add',
      message:
        `${isUpdate ? 'Would update' : 'Would add'} mcpServers.${name} in ${configPath}:\n` +
        `  ${JSON.stringify({ [name]: desired })}`,
      plannedContent: output,
    };
  }

  let backupPath: string | undefined;
  if (exists) {
    backupPath = backupFile(configPath, opts.now);
  } else {
    ensureParentDir(configPath);
  }
  fs.writeFileSync(configPath, output, 'utf8');

  return {
    status: isUpdate ? 'updated' : 'added',
    message: `${isUpdate ? 'Updated' : 'Added'} mcpServers.${name} in ${configPath}`,
    backupPath,
  };
}
