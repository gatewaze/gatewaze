import { describe, it, expect, vi } from 'vitest';
import { recordUsage, callAnthropic, callOpenAI } from '../record';
import { BudgetExceededError } from '../errors';

function mockSupabase(rpcImpl: (fn: string, args: Record<string, unknown>) => unknown) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      const data = rpcImpl(fn, args);
      return { data, error: null };
    }),
  };
}

describe('recordUsage', () => {
  it('returns the row when status is ok', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 1, budget_status: 'ok', current_spend_usd: 0.5, hard_cap_usd: 100, resets_at: '2026-05-07T00:00:00Z' },
    ]);
    const row = await recordUsage(sb, {
      brand_id: 'aaif', provider: 'anthropic', product: 'claude-sonnet-4-6',
      feature: 'test', units_in: 100, units_out: 50, cost_usd: 0.0015,
    });
    expect(row.budget_status).toBe('ok');
    expect(sb.rpc).toHaveBeenCalledWith(
      'record_external_api_usage',
      expect.objectContaining({ p_brand_id: 'aaif' }),
    );
  });

  it('throws BudgetExceededError when over_hard', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 2, budget_status: 'over_hard', current_spend_usd: 105, hard_cap_usd: 100, resets_at: '2026-05-07T00:00:00Z' },
    ]);
    await expect(
      recordUsage(sb, {
        brand_id: 'aaif', provider: 'anthropic', product: 'x',
        feature: 'test', units_in: 0, units_out: 0, cost_usd: 5,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('does not throw on over_soft (only logs)', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 3, budget_status: 'over_soft', current_spend_usd: 60, hard_cap_usd: 100, resets_at: '2026-05-07T00:00:00Z' },
    ]);
    const row = await recordUsage(sb, {
      brand_id: 'aaif', provider: 'anthropic', product: 'x',
      feature: 'test', units_in: 0, units_out: 0, cost_usd: 5,
    });
    expect(row.budget_status).toBe('over_soft');
  });

  it('synthesises an ok row when the RPC errors out (non-fatal)', async () => {
    const sb = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'connection refused' } })),
    };
    const row = await recordUsage(sb, {
      brand_id: 'x', provider: 'y', product: 'z',
      feature: 'f', units_in: 0, units_out: 0, cost_usd: 0,
    });
    expect(row.budget_status).toBe('ok');
  });
});

describe('callAnthropic', () => {
  it('records usage from the response.usage field', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 1, budget_status: 'ok', current_spend_usd: 0, hard_cap_usd: null, resets_at: null },
    ]);
    const fakeAnthropic = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ text: 'ok' }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        })),
      },
    };
    const result = await callAnthropic(
      sb,
      { brand_id: 'aaif', feature: 'test', model: 'claude-sonnet-4-6' },
      (a) => a.messages.create({ messages: [] }),
      fakeAnthropic,
    );
    // Cost = (1000/1M)*3 + (500/1M)*15 = 0.003 + 0.0075 = 0.0105
    const args = sb.rpc.mock.calls[0][1] as { p_units_in: number; p_units_out: number; p_cost_usd: number };
    expect(args.p_units_in).toBe(1000);
    expect(args.p_units_out).toBe(500);
    expect(args.p_cost_usd).toBeCloseTo(0.0105, 6);
    expect(result).toHaveProperty('content');
  });

  it('handles missing usage gracefully', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 1, budget_status: 'ok', current_spend_usd: 0, hard_cap_usd: null, resets_at: null },
    ]);
    const fakeAnthropic = {
      messages: { create: vi.fn(async () => ({ content: [] })) },
    };
    await callAnthropic(
      sb,
      { brand_id: 'aaif', feature: 'test', model: 'claude-sonnet-4-6' },
      (a) => a.messages.create({}),
      fakeAnthropic,
    );
    const args = sb.rpc.mock.calls[0][1] as { p_units_in: number; p_units_out: number };
    expect(args.p_units_in).toBe(0);
    expect(args.p_units_out).toBe(0);
  });
});

describe('callOpenAI', () => {
  it('records usage from response.usage.prompt_tokens / completion_tokens', async () => {
    const sb = mockSupabase(() => [
      { inserted_id: 1, budget_status: 'ok', current_spend_usd: 0, hard_cap_usd: null, resets_at: null },
    ]);
    const fakeOpenAI = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 200, completion_tokens: 100 },
          })),
        },
      },
    };
    await callOpenAI(
      sb,
      { brand_id: 'aaif', feature: 'test', model: 'gpt-4o' },
      (o) => o.chat.completions.create({}),
      fakeOpenAI,
    );
    const args = sb.rpc.mock.calls[0][1] as { p_units_in: number; p_units_out: number };
    expect(args.p_units_in).toBe(200);
    expect(args.p_units_out).toBe(100);
  });
});
