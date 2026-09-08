import { afterEach, describe, expect, it } from 'vitest';
import { _resetRegistryForTests, deregisterMount, isMountLive, tryRegisterMount } from '../registry';

describe('embed mount registry', () => {
  afterEach(() => {
    _resetRegistryForTests();
  });

  it('registers the first mount', () => {
    const el = document.createElement('div');
    expect(tryRegisterMount(el)).toEqual({ ok: true });
    expect(isMountLive()).toBe(true);
  });

  it('refuses a second mount into the SAME element while one is live', () => {
    const el = document.createElement('div');
    tryRegisterMount(el);
    expect(tryRegisterMount(el)).toEqual({ ok: false });
  });

  it('refuses a second mount into a DIFFERENT element while one is live (no split-view support)', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    tryRegisterMount(first);
    expect(tryRegisterMount(second)).toEqual({ ok: false });
    expect(isMountLive()).toBe(true);
  });

  it('allows a new mount after deregistering the live one', () => {
    const el = document.createElement('div');
    tryRegisterMount(el);
    deregisterMount(el);
    expect(isMountLive()).toBe(false);
    expect(tryRegisterMount(el)).toEqual({ ok: true });
  });

  it('deregister is a no-op for an element that never registered', () => {
    const live = document.createElement('div');
    const other = document.createElement('div');
    tryRegisterMount(live);
    deregisterMount(other);
    expect(isMountLive()).toBe(true);
  });

  it('self-heals: a failed registration attempt does not poison the next one', () => {
    const el = document.createElement('div');
    tryRegisterMount(el);
    // Simulate mount()'s finally-block cleanup after a mid-mount throw.
    deregisterMount(el);
    expect(tryRegisterMount(el)).toEqual({ ok: true });
  });
});
