import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveName, isNewerVersion, ownVersion } from '../src/util.js';

test('isNewerVersion: strictly newer only', () => {
  assert.equal(isNewerVersion('1.3.98', '1.3.99'), true);
  assert.equal(isNewerVersion('1.3.98', '1.4.0'), true);
  assert.equal(isNewerVersion('0.1.0', '1.3.98'), true);
  assert.equal(isNewerVersion('1.3.98', '1.3.98'), false);
  assert.equal(isNewerVersion('1.3.99', '1.3.98'), false);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), false);
});

test('isNewerVersion: prerelease tags ignored, missing fields are zero', () => {
  assert.equal(isNewerVersion('1.3.98-beta.1', '1.3.98'), false);
  assert.equal(isNewerVersion('1.3', '1.3.1'), true);
  assert.equal(isNewerVersion('1.3.0', '1.3'), false);
});

test('ownVersion reads package.json', () => {
  const v = ownVersion();
  assert.ok(v === null || /^\d+\.\d+\.\d+/.test(v));
});

test('deriveName skips generic hostname labels', () => {
  assert.equal(deriveName('https://mcp.aaif.live/auth'), 'aaif');
  assert.equal(deriveName('not a url'), 'gatewaze');
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyClaudeUserConfig } from '../src/clients/claude-code.js';

test('applyClaudeUserConfig adds, preserves, conflicts, backs up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwc-'));
  const p = path.join(dir, '.claude.json');
  fs.writeFileSync(p, JSON.stringify({ existingKey: true, mcpServers: { other: { type: 'http', url: 'https://x' } } }));

  const added = applyClaudeUserConfig(p, 'AAIF', 'https://mcp.aaif.live/auth');
  assert.equal(added.status, 'added');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(cfg.existingKey, true);
  assert.deepEqual(cfg.mcpServers.AAIF, { type: 'http', url: 'https://mcp.aaif.live/auth' });
  assert.deepEqual(cfg.mcpServers.other, { type: 'http', url: 'https://x' });
  assert.ok(added.backupPath && fs.existsSync(added.backupPath));

  assert.equal(applyClaudeUserConfig(p, 'AAIF', 'https://mcp.aaif.live/auth').status, 'unchanged');
  assert.equal(applyClaudeUserConfig(p, 'AAIF', 'https://other.example/auth').status, 'conflict');
  assert.equal(applyClaudeUserConfig(p, 'AAIF', 'https://other.example/auth', { overwrite: true }).status, 'updated');

  fs.writeFileSync(p, 'not json');
  assert.equal(applyClaudeUserConfig(p, 'AAIF', 'https://mcp.aaif.live/auth').status, 'error');
});
