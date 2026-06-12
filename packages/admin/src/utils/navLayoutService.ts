import { supabase } from '@/lib/supabase';
import type { NavLayout } from '@gatewaze/shared/modules';

/**
 * Client for the admin nav-layout API (`/api/admin/nav-layout/*`). The org
 * endpoints are super_admin-gated server-side; the `me` endpoints are scoped
 * to the caller by RLS.
 */

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

const base = () => `${import.meta.env.VITE_API_URL ?? ''}/api/admin/nav-layout`;

type Scope = 'org' | 'me';

async function load(scope: Scope): Promise<NavLayout | null> {
  const res = await apiFetch(`${base()}/${scope}`);
  if (!res.ok) {
    throw new Error(`Failed to load ${scope} navigation layout (${res.status})`);
  }
  const body = (await res.json()) as { layout: NavLayout | null };
  return body.layout;
}

async function save(scope: Scope, layout: NavLayout | null): Promise<NavLayout | null> {
  const res = await apiFetch(`${base()}/${scope}`, {
    method: 'PUT',
    body: JSON.stringify({ layout }),
  });
  if (!res.ok) {
    let message = `Failed to save ${scope} navigation layout (${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { layout: NavLayout | null };
  return body.layout;
}

export const navLayoutService = {
  getOrgLayout: () => load('org'),
  getMyLayout: () => load('me'),
  saveOrgLayout: (layout: NavLayout | null) => save('org', layout),
  saveMyLayout: (layout: NavLayout | null) => save('me', layout),
};
