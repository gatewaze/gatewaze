/**
 * Server-side writes to what was a Supabase bucket.
 *
 * On a brand that serves its buckets from another provider (storage module
 * `supabase_alias`) these go through the storage registry's bucketStore,
 * with the service role. Everywhere else they are the same supabase.storage
 * calls as before, on the client the caller passes in (which may be
 * user-scoped, so Supabase's storage RLS still applies there). Callers that
 * pass a user-scoped client must authorise the caller themselves before the
 * aliased path, which has no RLS: see routes/avatars.ts.
 *
 * Both return `{ error }` the way supabase-js does, so call sites keep their
 * shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { aliasedBucketStore } from './storage-registry.js';

export interface UploadOptions {
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function uploadToBucket(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  body: Buffer,
  opts: UploadOptions,
): Promise<{ error: { message: string } | null }> {
  try {
    const store = await aliasedBucketStore(bucket);
    if (store) {
      await store.put(path, body, {
        contentType: opts.contentType,
        upsert: opts.upsert ?? false,
        // supabase-js takes seconds; the store takes a Cache-Control value.
        ...(opts.cacheControl
          ? { cacheControl: /^\d+$/.test(opts.cacheControl) ? `public, max-age=${opts.cacheControl}` : opts.cacheControl }
          : {}),
      });
      return { error: null };
    }
  } catch (err) {
    return { error: { message: message(err) } };
  }
  const { error } = await supabase.storage.from(bucket).upload(path, body, opts);
  return { error: error ? { message: error.message } : null };
}

export async function removeFromBucket(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<{ error: { message: string } | null }> {
  try {
    const store = await aliasedBucketStore(bucket);
    if (store) {
      const { failed } = await store.remove(paths);
      return { error: failed.length ? { message: `could not remove ${failed.length} object(s)` } : null };
    }
  } catch (err) {
    return { error: { message: message(err) } };
  }
  const { error } = await supabase.storage.from(bucket).remove(paths);
  return { error: error ? { message: error.message } : null };
}
