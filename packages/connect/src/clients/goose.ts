import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, parseDocument } from 'yaml';
import type { ApplyOptions, ApplyResult } from '../types.js';
import { backupFile, deepEqual, ensureParentDir } from '../util.js';

/** Goose CLI and Goose Desktop share one config file. */
export function gooseConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Block', 'goose', 'config', 'config.yaml');
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(configHome, 'goose', 'config.yaml');
}

export interface GooseExtensionEntry {
  enabled: boolean;
  name: string;
  type: 'streamable_http';
  uri: string;
  timeout: number;
}

export function gooseExtensionEntry(name: string, serverUrl: string): GooseExtensionEntry {
  return { enabled: true, name, type: 'streamable_http', uri: serverUrl, timeout: 300 };
}

/** Desktop one-click alternative to editing the config file. */
export function gooseDeepLink(name: string, serverUrl: string): string {
  return `goose://extension?url=${encodeURIComponent(serverUrl)}&name=${encodeURIComponent(name)}`;
}

/**
 * Add (or update) an entry in the `extensions:` map of Goose's config.yaml.
 * Parses with the yaml Document API so existing content, comments and
 * formatting are preserved as far as the library allows. The file is backed
 * up to config.yaml.bak-<timestamp> before writing.
 */
export function applyGooseConfig(
  configPath: string,
  name: string,
  serverUrl: string,
  opts: ApplyOptions = {}
): ApplyResult {
  const desired = gooseExtensionEntry(name, serverUrl);

  const exists = fs.existsSync(configPath);
  let doc: Document;
  if (exists) {
    const raw = fs.readFileSync(configPath, 'utf8');
    doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      return {
        status: 'error',
        message: `Could not parse ${configPath} (${doc.errors[0].message}); refusing to modify it.`,
      };
    }
  } else {
    doc = new Document({});
  }

  const existingNode = doc.getIn(['extensions', name]);
  const existing =
    existingNode !== undefined && existingNode !== null && typeof (existingNode as any).toJSON === 'function'
      ? (existingNode as any).toJSON()
      : existingNode;
  const isUpdate = existing !== undefined;

  if (isUpdate && deepEqual(existing, desired)) {
    return { status: 'unchanged', message: `Extension "${name}" is already configured for this server.` };
  }
  if (isUpdate && !opts.overwrite && !opts.dryRun) {
    return {
      status: 'conflict',
      message:
        `An extension named "${name}" already exists in ${configPath} with different settings ` +
        `(currently: ${JSON.stringify(existing)}).`,
    };
  }

  doc.setIn(['extensions', name], desired);
  const output = doc.toString();

  if (opts.dryRun) {
    return {
      status: isUpdate ? 'would-update' : 'would-add',
      message:
        `${isUpdate ? 'Would update' : 'Would add'} extensions.${name} in ${configPath}:\n` +
        `  ${JSON.stringify(desired)}`,
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
    message: `${isUpdate ? 'Updated' : 'Added'} extensions.${name} in ${configPath}`,
    backupPath,
  };
}
