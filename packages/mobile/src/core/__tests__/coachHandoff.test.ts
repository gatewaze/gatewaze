import test from 'node:test';
import assert from 'node:assert/strict';

import { consumeCoachHandoff, hasPendingHandoff, requestCoachHandoff } from '../coachHandoff';

test.afterEach(() => {
  consumeCoachHandoff();
});

test('requesting a handoff makes it pending without clearing it', () => {
  requestCoachHandoff({ text: 'hello', mode: null });
  assert.equal(hasPendingHandoff(), true);
  assert.equal(hasPendingHandoff(), true);
});

test('consuming returns the message once, then null', () => {
  requestCoachHandoff({ text: 'hello', mode: null });
  assert.deepEqual(consumeCoachHandoff(), { text: 'hello', mode: null });
  assert.equal(consumeCoachHandoff(), null);
  assert.equal(hasPendingHandoff(), false);
});

test('a mode-only handoff is returned intact', () => {
  requestCoachHandoff({ text: '', mode: 'core:camera' });
  assert.deepEqual(consumeCoachHandoff(), { text: '', mode: 'core:camera' });
});

test('a second request replaces the first', () => {
  requestCoachHandoff({ text: 'first', mode: null });
  requestCoachHandoff({ text: 'second', mode: 'core:camera' });
  assert.deepEqual(consumeCoachHandoff(), { text: 'second', mode: 'core:camera' });
  assert.equal(consumeCoachHandoff(), null);
});
