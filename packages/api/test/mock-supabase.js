import { vi } from 'vitest';
/**
 * Creates a chainable mock that mimics the Supabase query builder pattern.
 * Call `mockResult()` to set what the final query resolves to.
 */
export function createMockSupabase() {
    let result = {
        data: null,
        error: null,
    };
    const chain = {};
    const buildChain = () => {
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
        const thenFn = (_resolve) => _resolve(result);
        Object.defineProperty(chain, 'then', {
            value: (resolve, reject) => Promise.resolve(thenFn(resolve)).catch(reject),
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
        mockResult(data, error = null, count) {
            result = { data, error, count };
        },
        /**
         * Set the query to resolve with an error.
         */
        mockError(message) {
            result = { data: null, error: { message } };
        },
    };
}
//# sourceMappingURL=mock-supabase.js.map