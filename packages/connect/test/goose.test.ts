import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { applyGooseConfig, gooseDeepLink, gooseExtensionEntry } from '../src/clients/goose.js';

const SERVER = 'https://mcp.example.test/';

const SAMPLE = `# Goose configuration
GOOSE_PROVIDER: anthropic
GOOSE_MODEL: claude-sonnet-4-5

extensions:
  # built-in developer tools
  developer:
    enabled: true
    type: builtin
    name: developer
  memory:
    enabled: false
    type: builtin
    name: memory
`;

function tmpConfig(content: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-connect-yaml-'));
  const file = path.join(dir, 'config.yaml');
  if (content !== null) fs.writeFileSync(file, content);
  return file;
}

test('appends to extensions map preserving existing content, comments and creating a backup', () => {
  const file = tmpConfig(SAMPLE);

  const result = applyGooseConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'added');

  const rawAfter = fs.readFileSync(file, 'utf8');
  // Comments survive the yaml Document round-trip
  assert.ok(rawAfter.includes('# Goose configuration'));
  assert.ok(rawAfter.includes('# built-in developer tools'));

  const after = parse(rawAfter);
  // Existing content preserved
  assert.equal(after.GOOSE_PROVIDER, 'anthropic');
  assert.equal(after.GOOSE_MODEL, 'claude-sonnet-4-5');
  assert.deepEqual(after.extensions.developer, { enabled: true, type: 'builtin', name: 'developer' });
  assert.deepEqual(after.extensions.memory, { enabled: false, type: 'builtin', name: 'memory' });
  // New entry with the required shape
  assert.deepEqual(after.extensions.aaif, {
    enabled: true,
    name: 'aaif',
    type: 'streamable_http',
    uri: SERVER,
    timeout: 300,
  });

  // Backup created as config.yaml.bak-<timestamp>, containing the original
  assert.ok(result.backupPath, 'expected a backup path');
  assert.match(path.basename(result.backupPath!), /^config\.yaml\.bak-\d{8}-\d{6}$/);
  assert.equal(fs.readFileSync(result.backupPath!, 'utf8'), SAMPLE);
});

test('creates the file (with extensions map) when missing', () => {
  const file = tmpConfig(null);
  const result = applyGooseConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'added');
  const after = parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.extensions.aaif, gooseExtensionEntry('aaif', SERVER));
});

test('identical existing entry is a no-op', () => {
  const file = tmpConfig(SAMPLE);
  applyGooseConfig(file, 'aaif', SERVER);
  const again = applyGooseConfig(file, 'aaif', SERVER);
  assert.equal(again.status, 'unchanged');
});

test('conflicting entry is not clobbered without overwrite', () => {
  const withConflict = SAMPLE + `  aaif:\n    enabled: true\n    type: stdio\n    name: aaif\n`;
  const file = tmpConfig(withConflict);

  const result = applyGooseConfig(file, 'aaif', SERVER);
  assert.equal(result.status, 'conflict');
  assert.equal(fs.readFileSync(file, 'utf8'), withConflict);

  const forced = applyGooseConfig(file, 'aaif', SERVER, { overwrite: true });
  assert.equal(forced.status, 'updated');
  const after = parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.extensions.aaif, gooseExtensionEntry('aaif', SERVER));
  // untouched siblings survive the overwrite
  assert.deepEqual(after.extensions.developer, { enabled: true, type: 'builtin', name: 'developer' });
});

test('dry-run writes nothing', () => {
  const file = tmpConfig(SAMPLE);
  const result = applyGooseConfig(file, 'aaif', SERVER, { dryRun: true });
  assert.equal(result.status, 'would-add');
  assert.ok(result.plannedContent?.includes('streamable_http'));
  assert.equal(fs.readFileSync(file, 'utf8'), SAMPLE);
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1, 'no backup in dry-run');
});

test('deep link encodes url and name', () => {
  assert.equal(
    gooseDeepLink('aaif', SERVER),
    'goose://extension?url=https%3A%2F%2Fmcp.example.test%2F&name=aaif'
  );
});
