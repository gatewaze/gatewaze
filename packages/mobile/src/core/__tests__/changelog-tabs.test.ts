import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableChangelogTabs, resolveChangelogTab } from '../changelog-tabs';

test('no history path gives only the releases tab', () => {
  assert.deepEqual(availableChangelogTabs(null), ['releases']);
});

test('a history path gives both tabs, releases first', () => {
  assert.deepEqual(availableChangelogTabs('/m/health-core/my-feedback'), ['releases', 'feedback']);
});

test('feedback is kept when the tab is available', () => {
  assert.equal(resolveChangelogTab('feedback', ['releases', 'feedback']), 'feedback');
});

test('feedback falls back to releases when the tab is not available', () => {
  assert.equal(resolveChangelogTab('feedback', ['releases']), 'releases');
});

test('releases stays releases', () => {
  assert.equal(resolveChangelogTab('releases', ['releases', 'feedback']), 'releases');
});
