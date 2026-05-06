import { describe, it, expect } from 'vitest';
import { estimateCostUsd, priceFor } from '../pricing';

describe('priceFor', () => {
  it('returns null for unknown models', () => {
    expect(priceFor('anthropic', 'no-such-model')).toBeNull();
    expect(priceFor('openai', 'no-such-model')).toBeNull();
  });

  it('looks up known Anthropic models', () => {
    const p = priceFor('anthropic', 'claude-sonnet-4-6');
    expect(p).not.toBeNull();
    expect(p!.input_per_million).toBe(3.0);
    expect(p!.output_per_million).toBe(15.0);
  });

  it('looks up known OpenAI models', () => {
    const p = priceFor('openai', 'gpt-4o');
    expect(p).not.toBeNull();
    expect(p!.output_per_million).toBe(10.0);
  });
});

describe('estimateCostUsd', () => {
  it('returns 0 for unknown model', () => {
    expect(estimateCostUsd('anthropic', 'no-such', 1_000_000, 1_000_000)).toBe(0);
  });

  it('computes input + output cost from per-million rates', () => {
    // Sonnet 4.6: $3 input + $15 output per 1M
    const cost = estimateCostUsd('anthropic', 'claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18.0, 6);
  });

  it('handles partial usage', () => {
    // 100k in + 50k out at gpt-4o ($2.50 in / $10 out per 1M)
    // = 0.1 * 2.50 + 0.05 * 10 = 0.25 + 0.50 = 0.75
    const cost = estimateCostUsd('openai', 'gpt-4o', 100_000, 50_000);
    expect(cost).toBeCloseTo(0.75, 6);
  });

  it('handles zero tokens', () => {
    expect(estimateCostUsd('openai', 'gpt-4o', 0, 0)).toBe(0);
  });
});
