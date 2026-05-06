/**
 * Cost-helper SDK — wraps Anthropic / OpenAI SDK calls with per-call usage
 * recording and pre-call hard-cap enforcement. See spec §15.3.
 *
 * The Supabase client passed in must have permission to call the
 * `record_external_api_usage` RPC. In practice that means service-role for
 * worker / API code, and the user's session for Edge functions running with
 * `auth.uid()` (the RPC is granted to `authenticated`).
 */

import { BudgetExceededError } from './errors';
import { estimateCostUsd, type Provider } from './pricing';

// Loose typing for the Supabase client to avoid a hard dependency in shared.
// Each caller passes their already-constructed @supabase/supabase-js client.
interface MinimalSupabase {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface UsageRecord {
  brand_id: string;
  provider: string;
  product: string;
  feature: string;
  units_in: number;
  units_out: number;
  cost_usd: number;
  request_id?: string;
  context?: Record<string, unknown>;
}

interface RecordRpcRow {
  inserted_id: number;
  budget_status: 'ok' | 'over_soft' | 'over_hard' | 'no_budget';
  current_spend_usd: number;
  hard_cap_usd: number | null;
  resets_at: string | null;
}

/**
 * Insert one ledger row and return budget status. Best-effort: if the RPC
 * fails (network blip, missing extension, etc) we log and return 'ok' so
 * the calling feature isn't blocked by cost-tracking outages.
 *
 * Throws BudgetExceededError when the result reports `over_hard`.
 */
export async function recordUsage(
  supabase: MinimalSupabase,
  record: UsageRecord,
): Promise<RecordRpcRow> {
  const { data, error } = await supabase.rpc('record_external_api_usage', {
    p_brand_id:   record.brand_id,
    p_provider:   record.provider,
    p_product:    record.product,
    p_feature:    record.feature,
    p_units_in:   record.units_in,
    p_units_out:  record.units_out,
    p_cost_usd:   record.cost_usd,
    p_request_id: record.request_id ?? null,
    p_context:    record.context ?? {},
  });
  if (error) {
    // Non-fatal: log and synthesise an 'ok' row.
    console.warn('[cost-helper] record_external_api_usage failed:', error.message);
    return {
      inserted_id: 0,
      budget_status: 'ok',
      current_spend_usd: 0,
      hard_cap_usd: null,
      resets_at: null,
    };
  }
  // Postgres functions returning TABLE come back as an array.
  const row = Array.isArray(data) ? (data[0] as RecordRpcRow) : (data as RecordRpcRow);
  if (
    row.budget_status === 'over_hard' &&
    row.hard_cap_usd != null &&
    row.resets_at
  ) {
    throw new BudgetExceededError({
      brand_id: record.brand_id,
      provider: record.provider,
      period: 'daily', // RPC chooses; surfaced to caller as best-effort 'daily' label
      hard_cap_usd: Number(row.hard_cap_usd),
      current_spend_usd: Number(row.current_spend_usd),
      resets_at: row.resets_at,
    });
  }
  return row;
}

/**
 * Pre-flight budget check. Returns true if the call is allowed. When the
 * caller knows the cost up front (e.g. proxy bandwidth in Python) it can
 * skip this and let `recordUsage` raise post-hoc — the design accepts that
 * the very first call to push spend over the cap still goes through.
 */
export async function checkBudget(
  supabase: MinimalSupabase,
  args: { brand_id: string; provider: string },
): Promise<{ allowed: boolean; row: RecordRpcRow | null }> {
  // Implemented as a probe insert of $0; cleaner alternatives require an
  // additional RPC. Phase 2 candidate.
  try {
    const row = await recordUsage(supabase, {
      brand_id: args.brand_id,
      provider: args.provider,
      product: 'budget-probe',
      feature: 'cost-governance:probe',
      units_in: 0,
      units_out: 0,
      cost_usd: 0,
      context: { probe: true },
    });
    return { allowed: row.budget_status !== 'over_hard', row };
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      return { allowed: false, row: null };
    }
    throw e;
  }
}

interface AnthropicLikeClient {
  messages: {
    create: (params: unknown) => Promise<{
      usage?: { input_tokens?: number; output_tokens?: number };
      [key: string]: unknown;
    }>;
  };
}

interface OpenAILikeClient {
  chat: {
    completions: {
      create: (params: unknown) => Promise<{
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        [key: string]: unknown;
      }>;
    };
  };
}

/**
 * Wrap an Anthropic call with budget enforcement + ledger insert.
 *
 * Caller passes the model name explicitly (we don't try to extract it from
 * the response, which may differ when prompt-routing is in play).
 *
 * The wrapper does the call, derives cost from `response.usage`, records
 * the ledger row, then returns the response. If the ledger row reports
 * `over_hard` AFTER the call succeeded, BudgetExceededError still throws —
 * meaning a call that pushed spend over the cap counts but the *next* call
 * can't go through.
 */
export async function callAnthropic<T>(
  supabase: MinimalSupabase,
  args: {
    brand_id: string;
    feature: string;
    model: string;
    context?: Record<string, unknown>;
  },
  fn: (anthropic: AnthropicLikeClient) => Promise<T>,
  anthropicClient: AnthropicLikeClient,
): Promise<T> {
  const result = await fn(anthropicClient);
  const usage = (result as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const tokens_in  = usage?.input_tokens  ?? 0;
  const tokens_out = usage?.output_tokens ?? 0;
  const cost_usd = estimateCostUsd('anthropic', args.model, tokens_in, tokens_out);
  await recordUsage(supabase, {
    brand_id: args.brand_id,
    provider: 'anthropic',
    product: args.model,
    feature: args.feature,
    units_in: tokens_in,
    units_out: tokens_out,
    cost_usd,
    context: args.context,
  });
  return result;
}

export async function callOpenAI<T>(
  supabase: MinimalSupabase,
  args: {
    brand_id: string;
    feature: string;
    model: string;
    context?: Record<string, unknown>;
  },
  fn: (openai: OpenAILikeClient) => Promise<T>,
  openaiClient: OpenAILikeClient,
): Promise<T> {
  const result = await fn(openaiClient);
  const usage = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  const tokens_in  = usage?.prompt_tokens     ?? 0;
  const tokens_out = usage?.completion_tokens ?? 0;
  const cost_usd = estimateCostUsd('openai', args.model, tokens_in, tokens_out);
  await recordUsage(supabase, {
    brand_id: args.brand_id,
    provider: 'openai',
    product: args.model,
    feature: args.feature,
    units_in: tokens_in,
    units_out: tokens_out,
    cost_usd,
    context: args.context,
  });
  return result;
}
