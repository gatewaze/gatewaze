import { vi } from 'vitest';

/**
 * Creates a chainable mock that mimics the Supabase query builder pattern.
 * Call `mockResult()` to set what the final query resolves to.
 */
export function createMockSupabase() {
  let result: { data: unknown; error: unknown; count?: number } = {
    data: null,
    error: null,
  };

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const buildChain = (): Record<string, ReturnType<typeof vi.fn>> => {
    const methods = [
      'from',
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'neq',
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
        // Terminal methods return the result
        if (method === 'single' || method === 'maybeSingle') {
          return Promise.resolve(result);
        }
        return chain;
      });
    }

    // Make non-terminal methods thenable so `await query` works
    const thenFn = (_resolve: (value: unknown) => void) => _resolve(result);
    Object.defineProperty(chain, 'then', {
      value: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        Promise.resolve(thenFn(resolve)).catch(reject),
      enumerable: false,
    });

    return chain;
  };

  buildChain();

  return {
    client: chain,
    /**
     * Set what the next query will resolve to.
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
  };
}
