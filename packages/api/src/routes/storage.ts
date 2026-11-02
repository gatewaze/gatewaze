/**
 * Browser uploads for brands whose Supabase buckets are served from another
 * provider (storage module config `supabase_alias`, e.g. R2 on autodb and
 * tech.tickets).
 *
 *   POST /api/storage/sign-upload { bucket, path, contentType, bytes, upsert? }
 *     -> { url, method: 'PUT', headers, bucket, path, publicUrl }
 *     The browser then PUTs the file to `url` with exactly `headers`. For
 *     media speaker-submissions/ and talks/ the server picks the final path;
 *     callers use the returned path and publicUrl.
 *     409 { error: 'exists' } when not upsert and the object exists.
 *   POST /api/storage/delete { bucket, paths[] } -> { failed: string[] }
 *
 * Who may do what is in lib/storage-rules.ts. On a brand that is still on
 * Supabase Storage (AAIF) both routes answer 404 { error: 'not_enabled' }, and
 * the client helpers fall back to supabase-js, whose RLS applies as before.
 *
 * Labelled public because signed-out visitors may upload speaker
 * submissions; every request is IP rate-limited before anything else runs,
 * and the caller's identity is resolved per request (lib/auth/optional-caller).
 */

import type { NextFunction, Request, Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { ipRateLimiter } from '../lib/rate-limiter.js';
import { logger } from '../lib/logger.js';
import { isPlatformAdmin, resolveOptionalCaller } from '../lib/auth/optional-caller.js';
import { getStorageRegistry, storageAliasActive, type PlatformObjectStore } from '../lib/storage-registry.js';
import {
  isValidBucketName,
  maxBytesFor,
  requiredRole,
  roleSatisfies,
  safeObjectPath,
  serverChosenPath,
  serverKeyedPrefix,
  type Operation,
  type Role,
} from '../lib/storage-rules.js';

const SIGNED_UPLOAD_SECONDS = 15 * 60;
const MAX_DELETE_PATHS = 100;

export const storageRouter = labeledRouter('public');

// Every request: generous enough for an admin uploading a gallery.
storageRouter.use(ipRateLimiter({ points: 240, durationSecs: 60, bucket: 'storage-sign' }));
// Server-keyed (anyone may upload) prefixes: a speaker attaches a photo and
// perhaps a deck, and may retry a few times.
const anonUploadLimit = ipRateLimiter({ points: 20, durationSecs: 600, bucket: 'storage-sign-anon' });

storageRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await storageAliasActive())) {
      res.status(404).json({ error: 'not_enabled' });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

interface SignState {
  bucket: string;
  path: string;
  contentType: string;
  bytes: number;
  upsert: boolean;
  serverKeyed: string | null;
  role: Role;
}

const forbidden = (res: Response, role: Role) =>
  role === 'anon'
    ? res.status(401).json({ error: 'unauthenticated' })
    : res.status(403).json({ error: 'forbidden' });

/** The caller's role, checking admin only when it would change the answer. */
async function callerRole(req: Request, needAdmin: boolean): Promise<Role> {
  const caller = await resolveOptionalCaller(req);
  if (caller.kind === 'anon') return 'anon';
  if (needAdmin && (await isPlatformAdmin(caller.userId))) return 'admin';
  return 'authenticated';
}

async function storeFor(bucket: string, res: Response): Promise<PlatformObjectStore | null> {
  const registry = await getStorageRegistry();
  if (!registry) {
    res.status(503).json({ error: 'storage_unavailable' });
    return null;
  }
  try {
    return await registry.bucketStore(bucket);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), bucket }, '[storage] bucket store unavailable');
    res.status(503).json({ error: 'storage_unavailable' });
    return null;
  }
}

async function authorizeUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const { bucket, contentType: rawType, bytes, upsert } = body;
    const path = safeObjectPath(body.path);
    if (!isValidBucketName(bucket)) {
      res.status(400).json({ error: 'invalid_bucket' });
      return;
    }
    if (!path) {
      res.status(400).json({ error: 'invalid_path' });
      return;
    }
    if (typeof rawType !== 'string' || rawType.length > 255) {
      res.status(400).json({ error: 'invalid_content_type' });
      return;
    }
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
      res.status(400).json({ error: 'invalid_bytes' });
      return;
    }
    if (upsert !== undefined && typeof upsert !== 'boolean') {
      res.status(400).json({ error: 'invalid_upsert' });
      return;
    }
    const contentType = rawType.trim().toLowerCase();
    const serverKeyed = serverKeyedPrefix(bucket, path);
    // A server-picked key is always new, so it is always an insert.
    const op: Operation = upsert === true && !serverKeyed ? 'overwrite' : 'insert';
    const need = requiredRole(bucket, path, op);
    if (need === 'never') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const role = await callerRole(req, need === 'admin' || contentType === 'image/svg+xml');
    if (!roleSatisfies(role, need)) {
      forbidden(res, role);
      return;
    }
    const cap = maxBytesFor(contentType, role);
    if (cap === null) {
      res.status(400).json({ error: 'unsupported_content_type' });
      return;
    }
    if (bytes > cap) {
      res.status(413).json({ error: 'too_large', maxBytes: cap });
      return;
    }
    const state: SignState = { bucket, path, contentType, bytes, upsert: op === 'overwrite', serverKeyed, role };
    res.locals.storageSign = state;
    next();
  } catch (err) {
    next(err);
  }
}

function limitAnonUploads(req: Request, res: Response, next: NextFunction): void {
  const state = res.locals.storageSign as SignState;
  if (state.serverKeyed && state.role !== 'admin') {
    anonUploadLimit(req, res, next);
    return;
  }
  next();
}

storageRouter.post('/sign-upload', authorizeUpload, limitAnonUploads, async (_req: Request, res: Response) => {
  const state = res.locals.storageSign as SignState;
  try {
    const store = await storeFor(state.bucket, res);
    if (!store) return;
    const path = state.serverKeyed ? serverChosenPath(state.serverKeyed, state.path) : state.path;
    if (!state.upsert && (await store.head(path)).ok) {
      res.status(409).json({ error: 'exists' });
      return;
    }
    const signed = await store.signUpload(path, {
      contentType: state.contentType,
      bytes: state.bytes,
      expiresSeconds: SIGNED_UPLOAD_SECONDS,
    });
    res.json({
      url: signed.url,
      method: 'PUT',
      headers: signed.headers,
      bucket: state.bucket,
      path,
      publicUrl: store.publicUrl(path),
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), bucket: state.bucket }, '[storage] sign-upload failed');
    res.status(500).json({ error: 'sign_failed' });
  }
});

storageRouter.post('/delete', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const { bucket, paths } = body;
    if (!isValidBucketName(bucket)) {
      res.status(400).json({ error: 'invalid_bucket' });
      return;
    }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_DELETE_PATHS) {
      res.status(400).json({ error: 'invalid_paths' });
      return;
    }
    const clean: string[] = [];
    for (const p of paths) {
      const safe = safeObjectPath(p);
      if (!safe) {
        res.status(400).json({ error: 'invalid_path' });
        return;
      }
      clean.push(safe);
    }
    let need: Role = 'anon';
    for (const p of clean) {
      const r = requiredRole(bucket, p, 'delete');
      if (r === 'never') {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (!roleSatisfies(need, r)) need = r;
    }
    const role = await callerRole(req, need === 'admin');
    if (!roleSatisfies(role, need)) {
      forbidden(res, role);
      return;
    }
    const store = await storeFor(bucket, res);
    if (!store) return;
    const { failed } = await store.remove([...new Set(clean)]);
    res.json({ failed });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[storage] delete failed');
    res.status(500).json({ error: 'delete_failed' });
  }
});
