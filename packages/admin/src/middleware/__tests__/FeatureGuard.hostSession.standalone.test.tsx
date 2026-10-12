// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Standalone host-session, end to end through the real lib/supabase.ts,
// lib/hostSession.ts, SupabaseAuthService, AuthProvider and FeatureGuard.
// Only fetch (the session holder and PostgREST) and the permission lookup
// are faked.
vi.mock('@/hooks/usePermissions', () => ({
  useHasPermission: () => ({ hasPermission: true, loading: false }),
}));
vi.mock('@/utils/impersonationService', () => ({ ImpersonationService: {} }));
// Pulls in the generated module registry, which only the Vite plugin provides.
vi.mock('@/app/router/AccessDeniedRedirect', () => ({ AccessDeniedRedirect: () => null }));

const ORIGIN = window.location.origin;
const PROFILE = {
  id: 'profile-1', user_id: 'auth-1', email: 'admin@example.org', name: 'Admin', role: 'admin',
  is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// Answers for /me, in order; the last one repeats.
let meAnswers: Array<() => Response> = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === '/bff/me') return (meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0])();
  if (url.includes('/rest/v1/admin_profiles')) return json(200, [PROFILE]);
  return json(404, {});
});

let mod: typeof import('@/lib/supabase');
let Provider: typeof import('@/app/contexts/auth/Provider').AuthProvider;
let Guard: typeof import('../FeatureGuard').FeatureGuard;

beforeAll(async () => {
  vi.stubEnv('VITE_AUTH_MODE', 'host-session');
  vi.stubEnv('VITE_SUPABASE_URL', ORIGIN);
  vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal('fetch', fetchMock);
  mod = await import('@/lib/supabase');
  Provider = (await import('@/app/contexts/auth/Provider')).AuthProvider;
  Guard = (await import('../FeatureGuard')).FeatureGuard;
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // One client for the file: clear the shim's cached answer between tests.
  (mod.getSupabase().auth as unknown as { resetSignedOut: () => void }).resetSignedOut();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('standalone host-session: where the user lands', () => {
  it('/bff/me 403 (not an admin) -> /login, whose page shows the not-admin view', async () => {
    meAnswers = [() => json(403, { error: 'not_admin', email: 'someone@example.org' })];
    render(
      <Provider>
        <MemoryRouter initialEntries={['/newsletters']}>
          <Routes>
            <Route path="/newsletters" element={<Guard feature="newsletters"><div>NEWSLETTERS</div></Guard>} />
            <Route path="/login" element={<div>LOGIN</div>} />
            <Route path="/unauthorized" element={<div>UNAUTHORIZED</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByText('UNAUTHORIZED')).not.toBeInTheDocument();
  });

  it('/bff/me 503 pending -> /login (the in-embed gate is for embeds only)', async () => {
    meAnswers = [() => json(503, { error: 'admin_check_pending' }, { 'retry-after': '1' })];
    render(
      <Provider>
        <MemoryRouter initialEntries={['/newsletters']}>
          <Routes>
            <Route path="/newsletters" element={<Guard feature="newsletters"><div>NEWSLETTERS</div></Guard>} />
            <Route path="/login" element={<div>LOGIN</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => u === '/bff/me').length).toBeGreaterThan(0);
  });
});
