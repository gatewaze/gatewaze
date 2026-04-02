/**
 * Minimal Supabase client type used by module lifecycle and migration code.
 *
 * The real Supabase client's `select()` returns a builder that is both
 * thenable (await directly) and chainable (.eq(), etc.). This type
 * models that dual behavior so both lifecycle.ts and migrations.ts
 * can share the same client reference without type errors.
 */

export type SelectResult<T = Record<string, unknown>> = Promise<{ data: T[] | null; error: unknown }> & {
  eq: (col: string, val: string) => Promise<{ data: T[] | null; error: unknown }>;
};

export type SupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => SelectResult;
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => Promise<{ error: unknown }>;
    update: (fields: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
    upsert: (row: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict: string }) => Promise<{ error: unknown }>;
  };
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>;
};
