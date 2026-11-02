import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESS_FILL_ALPHA,
  PRESS_FILL_IN_MS,
  PRESS_FILL_OUT_MS,
  SWAP_MS,
  pressLayerOpacities,
} from '../glassPress';
import { motion } from '../../theme/tokens';

test('pressLayerOpacities(0) shows only the rest glyph', () => {
  assert.deepEqual(pressLayerOpacities(0), { rest: 1, pressed: 0 });
});

test('pressLayerOpacities(1) shows only the pressed glyph', () => {
  assert.deepEqual(pressLayerOpacities(1), { rest: 0, pressed: 1 });
});

test('pressLayerOpacities(0.5) splits evenly', () => {
  assert.deepEqual(pressLayerOpacities(0.5), { rest: 0.5, pressed: 0.5 });
});

test('pressLayerOpacities clamps overshoot below 0', () => {
  assert.deepEqual(pressLayerOpacities(-0.2), { rest: 1, pressed: 0 });
});

test('pressLayerOpacities clamps overshoot above 1', () => {
  assert.deepEqual(pressLayerOpacities(1.3), { rest: 0, pressed: 1 });
});

test('the pressed fill stays translucent', () => {
  assert.ok(PRESS_FILL_ALPHA > 0);
  assert.ok(PRESS_FILL_ALPHA < 1);
});

test('the press fade durations are positive and within motion.quick', () => {
  for (const ms of [PRESS_FILL_IN_MS, PRESS_FILL_OUT_MS, SWAP_MS]) {
    assert.ok(ms > 0);
    assert.ok(ms <= motion.quick);
  }
});
