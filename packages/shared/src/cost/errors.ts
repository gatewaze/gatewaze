/**
 * Typed error raised by the cost helpers when a hard budget cap is exceeded.
 * See spec-scrapling-fetcher-service.md §15.4.
 *
 * Callers should `instanceof BudgetExceededError` to translate into a
 * feature-appropriate degradation (HTTP 429 with Retry-After for API/Edge,
 * skip-with-log for scrapers, etc).
 */
export class BudgetExceededError extends Error {
  readonly brand_id: string;
  readonly provider: string;
  readonly period: 'daily' | 'monthly';
  readonly hard_cap_usd: number;
  readonly current_spend_usd: number;
  readonly resets_at: string;
  readonly retry_after_seconds: number;

  constructor(args: {
    brand_id: string;
    provider: string;
    period: 'daily' | 'monthly';
    hard_cap_usd: number;
    current_spend_usd: number;
    resets_at: string;
  }) {
    super(
      `Budget exceeded for ${args.brand_id}/${args.provider} (${args.period}): ` +
        `$${args.current_spend_usd.toFixed(4)} >= $${args.hard_cap_usd.toFixed(2)}; ` +
        `resets at ${args.resets_at}`,
    );
    this.name = 'BudgetExceededError';
    this.brand_id = args.brand_id;
    this.provider = args.provider;
    this.period = args.period;
    this.hard_cap_usd = args.hard_cap_usd;
    this.current_spend_usd = args.current_spend_usd;
    this.resets_at = args.resets_at;
    this.retry_after_seconds = Math.max(
      1,
      Math.ceil((Date.parse(args.resets_at) - Date.now()) / 1000),
    );
  }
}
