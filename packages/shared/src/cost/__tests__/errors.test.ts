import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BudgetExceededError } from '../errors';

describe('BudgetExceededError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is an Error and is instanceof-checkable', () => {
    const e = new BudgetExceededError({
      brand_id: 'aaif',
      provider: 'anthropic',
      period: 'daily',
      hard_cap_usd: 100,
      current_spend_usd: 105.5,
      resets_at: '2026-05-07T00:00:00Z',
    });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect(e.name).toBe('BudgetExceededError');
  });

  it('exposes structured fields for callers', () => {
    const e = new BudgetExceededError({
      brand_id: 'mlops',
      provider: 'rayobyte',
      period: 'monthly',
      hard_cap_usd: 50,
      current_spend_usd: 50.001,
      resets_at: '2026-06-01T00:00:00Z',
    });
    expect(e.brand_id).toBe('mlops');
    expect(e.provider).toBe('rayobyte');
    expect(e.period).toBe('monthly');
    expect(e.hard_cap_usd).toBe(50);
  });

  it('computes a sensible retry_after_seconds (12h until midnight)', () => {
    const e = new BudgetExceededError({
      brand_id: 'aaif',
      provider: 'anthropic',
      period: 'daily',
      hard_cap_usd: 1,
      current_spend_usd: 2,
      resets_at: '2026-05-07T00:00:00Z',
    });
    expect(e.retry_after_seconds).toBe(12 * 3600);
  });

  it('clamps retry_after_seconds to >= 1 if reset is in the past', () => {
    const e = new BudgetExceededError({
      brand_id: 'aaif',
      provider: 'anthropic',
      period: 'daily',
      hard_cap_usd: 1,
      current_spend_usd: 2,
      resets_at: '2025-01-01T00:00:00Z',
    });
    expect(e.retry_after_seconds).toBe(1);
  });
});
