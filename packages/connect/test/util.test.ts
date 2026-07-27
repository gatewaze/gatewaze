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
