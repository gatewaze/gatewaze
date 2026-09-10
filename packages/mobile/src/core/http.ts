/**
 * The authed API client primitive (spec-mobile-app.md "API contract and
 * types"). One place attaches auth, retries once on 401 after a forced
 * refresh, and maps every error into the typed failure taxonomy. Module
 * contributions build their typed call slices on this.
 *
 * Error body convention (matches the health routes and the portal's
 * healthPortalApi): { error: { message, code? } } or { error: string }.
 */

import type { MobileFetchInit } from '@gatewaze/shared';
import { config } from './config';
import { ApiFailure, failureFromStatus, toFailure } from './errors';
import { getSupabase } from './auth/supabase';

const TIMEOUT_MS = 30_000;

async function accessToken(forceRefresh = false): Promise<string | undefined> {
  const supabase = getSupabase();
  if (forceRefresh) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

function parseErrorBody(body: unknown, status: number): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string') return { message: err };
    if (err && typeof err === 'object') {
      const e = err as { message?: unknown; code?: unknown };
      return {
        message: typeof e.message === 'string' ? e.message : `HTTP ${status}`,
        code: typeof e.code === 'string' ? e.code : undefined,
      };
    }
  }
  return { message: `HTTP ${status}` };
}

async function doFetch(path: string, init: MobileFetchInit, token: string | undefined) {
  const headers = new Headers(init.headers);
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (!isForm && init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${config.apiUrl}${path}`, {
      method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: isForm
        ? (init.body as FormData)
        : init.body !== undefined
          ? JSON.stringify(init.body)
          : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticated fetch. 204 → undefined; success → parsed JSON; everything
 * else throws an ApiFailure. Retries once on 401 after a forced refresh —
 * a refresh token expired through long absence makes that refresh fail,
 * which surfaces as an 'auth' failure and lands in the standard
 * sign-out path (handled by the session provider).
 */
/**
 * Defense-in-depth at the shared chokepoint (module api slices also
 * encodeURIComponent their path segments): reject traversal shapes before
 * the URL parser can collapse them, so a crafted deep-link param can never
 * redirect an authed request to a different endpoint.
 */
function assertSafePath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ApiFailure('client', 'Invalid API path');
  }
  if (/(^|\/)\.\.?(\/|$)/.test(path) || /%2e/i.test(path) || /[\\\r\n]/.test(path)) {
    throw new ApiFailure('client', 'Invalid API path');
  }
}

export async function apiFetch(path: string, init: MobileFetchInit = {}): Promise<unknown> {
  assertSafePath(path);
  let res: Response;
  try {
    res = await doFetch(path, init, await accessToken());
  } catch (err) {
    throw toFailure(err);
  }

  if (res.status === 401) {
    let token: string | undefined;
    try {
      token = await accessToken(true);
    } catch {
      token = undefined;
    }
    if (!token) throw new ApiFailure('auth', 'Session expired', 401);
    try {
      res = await doFetch(path, init, token);
    } catch (err) {
      throw toFailure(err);
    }
    if (res.status === 401) throw new ApiFailure('auth', 'Session expired', 401);
  }

  if (res.status === 204) return undefined;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const { message, code } = parseErrorBody(body, res.status);
    throw failureFromStatus(res.status, message, code);
  }

  return body;
}
