/**
 * Per-model price table for the cost helpers.
 *
 * Prices in USD per 1M tokens. Updated manually when providers change pricing.
 * Source: provider pricing pages, May 2026.
 *
 * Adding a model: add an entry below; run the unit tests to confirm
 * `priceFor(model)` returns the new entry, then deploy.
 */

export interface TokenPricing {
  /** USD per 1M input tokens. */
  input_per_million: number;
  /** USD per 1M output tokens. */
  output_per_million: number;
  /** Optional: USD per 1M cached input tokens (Anthropic prompt-cache reads). */
  cached_input_per_million?: number;
}

const ANTHROPIC_PRICING: Record<string, TokenPricing> = {
  // Claude 4.x family
  'claude-opus-4-7':       { input_per_million: 15.00, output_per_million: 75.00 },
  'claude-opus-4-6':       { input_per_million: 15.00, output_per_million: 75.00 },
  'claude-sonnet-4-6':     { input_per_million:  3.00, output_per_million: 15.00 },
  'claude-haiku-4-5':      { input_per_million:  1.00, output_per_million:  5.00 },
  // Legacy 3.x — kept for in-flight code that still pins these
  'claude-3-5-sonnet-20241022': { input_per_million: 3.00, output_per_million: 15.00 },
  'claude-3-haiku-20240307':    { input_per_million: 0.25, output_per_million:  1.25 },
};

const OPENAI_PRICING: Record<string, TokenPricing> = {
  'gpt-5.2':        { input_per_million: 5.00, output_per_million: 15.00 },
  'gpt-4o':         { input_per_million: 2.50, output_per_million: 10.00 },
  'gpt-4o-mini':    { input_per_million: 0.15, output_per_million:  0.60 },
  'gpt-4-turbo':    { input_per_million: 10.00, output_per_million: 30.00 },
  'o1':             { input_per_million: 15.00, output_per_million: 60.00 },
  'o1-mini':        { input_per_million:  3.00, output_per_million: 12.00 },
};

export type Provider = 'anthropic' | 'openai';

export function priceFor(provider: Provider, model: string): TokenPricing | null {
  const table = provider === 'anthropic' ? ANTHROPIC_PRICING : OPENAI_PRICING;
  return table[model] ?? null;
}

export function estimateCostUsd(
  provider: Provider,
  model: string,
  tokens_in: number,
  tokens_out: number,
): number {
  const pricing = priceFor(provider, model);
  if (!pricing) return 0;
  const input_cost  = (tokens_in  / 1_000_000) * pricing.input_per_million;
  const output_cost = (tokens_out / 1_000_000) * pricing.output_per_million;
  return input_cost + output_cost;
}
