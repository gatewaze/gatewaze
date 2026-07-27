import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyClaudeDesktopConfig, desktopServerEntry } from '../src/clients/claude-desktop.js';

const SERVER = 'https://mcp.example.test/';

function tmpConfig(content: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-connect-json-'));
  const file = path.join(dir, 'claude_desktop_config.json');
  if (content !== null) fs.writeFileSync(file, content);
  return file;
}

test('adds an entry while preserving all existing JSON content', () => {
  const original = {
    coworkUserFilesPath: '/Users/someone/Claude',
    preferences: { theme: 'dark', nested: { keep: [1, 2, 3] } },
    mcpServers: {
      existing: { command: 'node', args: ['server.js'] },
    },
  };
  const file = tmpConfig(JSON.stringify(original, null, 2));

  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'added');

  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Existing content preserved
  assert.deepEqual(after.preferences, original.preferences);
  assert.equal(after.coworkUserFilesPath, original.coworkUserFilesPath);
  assert.deepEqual(after.mcpServers.existing, original.mcpServers.existing);
  // New entry added with the mcp-remote shape
  assert.deepEqual(after.mcpServers.aaif, {
    command: 'npx',
    args: ['-y', 'mcp-remote', SERVER],
  });
  // Backup created
  assert.ok(result.backupPath, 'expected a backup path');
  assert.ok(fs.existsSync(result.backupPath!));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.backupPath!, 'utf8')), original);
});

test('creates mcpServers when the file has none', () => {
  const file = tmpConfig(JSON.stringify({ other: true }));
  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'added');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.other, true);
  assert.deepEqual(after.mcpServers.aaif, desktopServerEntry(SERVER));
});

test('identical existing entry is a no-op', () => {
  const file = tmpConfig(JSON.stringify({ mcpServers: { aaif: desktopServerEntry(SERVER) } }));
  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'unchanged');
});

test('conflicting entry is not clobbered without overwrite', () => {
  const conflicting = { mcpServers: { aaif: { command: 'other', args: [] } } };
  const file = tmpConfig(JSON.stringify(conflicting));

  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), conflicting);

  const forced = applyClaudeDesktopConfig(file, 'aaif', SERVER, { overwrite: true });
  assert.equal(forced.status, 'updated');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.aaif,
    desktopServerEntry(SERVER)
  );
});

test('dry-run writes nothing', () => {
  const before = JSON.stringify({ mcpServers: {} }, null, 2);
  const file = tmpConfig(before);
  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER, { dryRun: true });
  assert.equal(result.status, 'would-add');
  assert.ok(result.plannedContent?.includes('mcp-remote'));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1, 'no backup in dry-run');
});

test('unparseable JSON is refused, not clobbered', () => {
  const file = tmpConfig('{ not json !!');
  const result = applyClaudeDesktopConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'error');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json !!');
});
