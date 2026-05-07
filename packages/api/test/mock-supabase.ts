import { vi } from 'vitest';

/**
 * Creates a chainable mock that mimics the Supabase query builder pattern.
 * Call `mockResult()` to set what the final query resolves to.
 *
 * The chain returns the same `result` for every terminal call by default.
 * For tests that need different results across multiple sequential calls
 * (e.g. an RPC followed by an INSERT), use `mockResultsSequence([…])` to
 * queue per-call results.
 */
export function createMockSupabase() {
  let result: { data: unknown; error: unknown; count?: number } = {
    data: null,
    error: null,
  };
  let queue: Array<{ data: unknown; error: unknown; count?: number }> = [];

  // Pop the next queued result if there is one; otherwise return the
  // current sticky result. Lets a test express "first call returns X,
  // second call returns Y" without re-mocking between awaits.
  const consume = () => (queue.length > 0 ? queue.shift()! : result);

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const functions = {
    invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const buildChain = (): Record<string, ReturnType<typeof vi.fn>> => {
    const methods = [
      'from',
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'neq',
      'in',
      'ilike',
      'or',
      'order',
      'range',
      'limit',
      'single',
      'maybeSingle',
    ];

    for (const method of methods) {
      chain[method] = vi.fn().mockImplementation(() => {
        if (method === 'single' || method === 'maybeSingle') {
          return Promise.resolve(consume());
        }
        return chain;
      });
    }

    // RPC is terminal — supabase-js returns a thenable directly from
    // .rpc(). Implement as an async fn that consumes the queue.
    chain.rpc = vi.fn().mockImplementation(() => Promise.resolve(consume()));

    // Make non-terminal methods thenable so `await query` works
    const thenFn = (_resolve: (value: unknown) => void) => _resolve(consume());
    Object.defineProperty(chain, 'then', {
      value: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        Promise.resolve(thenFn(resolve)).catch(reject),
      enumerable: false,
    });

    // functions.invoke surface used by edge-function callers.
    Object.defineProperty(chain, 'functions', {
      value: functions,
      enumerable: false,
    });

    return chain;
  };

  buildChain();

  return {
    client: chain,
    functions,
    /**
     * Set what the next query will resolve to (sticky — every subsequent
     * call returns this until changed or until a queued result wins).
     */
    mockResult(data: unknown, error: unknown = null, count?: number) {
      result = { data, error, count };
    },
    /**
     * Set the query to resolve with an error.
     */
    mockError(message: string) {
      result = { data: null, error: { message } };
    },
    /**
     * Queue per-call results. Each terminal/await consumes one entry;
     * the sticky `result` is used once the queue is drained.
     */
    mockResultsSequence(results: Array<{ data: unknown; error?: unknown; count?: number }>) {
      queue = results.map((r) => ({ data: r.data, error: r.error ?? null, count: r.count }));
    },
  };
}
