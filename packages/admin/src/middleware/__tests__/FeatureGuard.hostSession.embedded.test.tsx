// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Embedded host-session, end to end through the real lib/supabase.ts,
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
const USER = { id: 'auth-1', email: 'admin@example.org', aud: 'authenticated' };
const PROFILE = {
  id: 'profile-1', user_id: 'auth-1', email: 'admin@example.org', name: 'Admin', role: 'admin',
  is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// Answers for /me, in order; the last one repeats.
let meAnswers: Array<() => Response | Promise<Response>> = [];
let profileAnswer: () => Response | Promise<Response> = () => json(200, [PROFILE]);
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === '/me') return (meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0])();
  if (url.includes('/rest/v1/admin_profiles')) return profileAnswer();
  return json(404, {});
});
const pending = () => json(503, { error: 'admin_check_pending' }, { 'retry-after': '1' });
const unavailable = () => json(503, { error: 'session_unavailable' });
const ok = () => json(200, { user: USER });

// Counts every render of the /login route, so a passing visit is caught too.
let loginVisits = 0;
function LoginPage() {
  loginVisits += 1;
  return <div>LOGIN</div>;
}

let mod: typeof import('@/lib/supabase');
let Provider: typeof import('@/app/contexts/auth/Provider').AuthProvider;
let Guard: typeof import('../FeatureGuard').FeatureGuard;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal('fetch', fetchMock);
  mod = await import('@/lib/supabase');
  (await import('@/embed/embedMode')).setEmbeddedMode(true);
  Provider = (await import('@/app/contexts/auth/Provider')).AuthProvider;
  Guard = (await import('../FeatureGuard')).FeatureGuard;
});

beforeEach(() => {
  fetchMock.mockClear();
  loginVisits = 0;
  profileAnswer = () => json(200, [PROFILE]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A new hook per test, as a re-mount would pass: clears the shim's cache.
  mod.configureHostSession({
    baseUrl: `${ORIGIN}/api/gatewaze/supabase`,
    anonKey: 'anon-key',
    meUrl: '/me',
    logoutUrl: '/logout',
    onSignedOut: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderEmbed() {
  return render(
    <Provider>
      <MemoryRouter initialEntries={['/newsletters']}>
        <Routes>
          <Route path="/newsletters" element={<Guard feature="newsletters"><div>NEWSLETTERS</div></Guard>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unauthorized" element={<div>UNAUTHORIZED</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('embedded host-session: where the user lands', () => {
  it('/me 403 (not an admin) -> /unauthorized, never /login', async () => {
    meAnswers = [() => json(403, { error: 'not_admin', email: 'someone@example.org' })];
    renderEmbed();

    expect(await screen.findByText('UNAUTHORIZED')).toBeInTheDocument();
    expect(screen.queryByText('LOGIN')).not.toBeInTheDocument();
  });

  it('/me 503 admin_check_pending -> "Checking your access" in the embed, then in once access arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Provider: getSession and getHostStatus; the gate is seeded with that
    // answer, so the next /me is its first poll, after Retry-After.
    meAnswers = [pending, pending, ok];
    renderEmbed();

    expect(await screen.findByText('Checking your access…', { selector: 'p:not([role="status"])' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => u === '/me')).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(await screen.findByText('NEWSLETTERS')).toBeInTheDocument();
    expect(loginVisits).toBe(0);
  });

  it('/me 503 session_unavailable -> Retry in the embed, then in once the session holder answers', async () => {
    meAnswers = [unavailable, unavailable, ok];
    renderEmbed();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('NEWSLETTERS')).toBeInTheDocument();
    expect(loginVisits).toBe(0);
  });

  it('pending then ok between the Provider\'s two calls -> straight in, never /login', async () => {
    meAnswers = [pending, ok];
    // A lookup that takes a moment, so the shim's SIGNED_IN path cannot
    // paper over an INITIALIZE that left the user out.
    profileAnswer = () => new Promise((resolve) => setTimeout(() => resolve(json(200, [PROFILE])), 50));
    renderEmbed();

    expect(await screen.findByText('NEWSLETTERS')).toBeInTheDocument();
    expect(loginVisits).toBe(0);
  });

  it('access arrives but the profile lookup fails -> Retry, not an endless spinner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    meAnswers = [pending, pending, ok];
    profileAnswer = () => json(500, { message: 'db down' });
    renderEmbed();
    await screen.findByText('Checking your access…', { selector: 'p:not([role="status"])' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(loginVisits).toBe(0);
  });

  it('access arrives but the profile lookup hangs -> Retry within the lookup budget', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    meAnswers = [pending, pending, ok];
    profileAnswer = () => new Promise<Response>(() => {});
    renderEmbed();
    await screen.findByText('Checking your access…', { selector: 'p:not([role="status"])' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a hung /me at start-up -> Retry once the failsafe fires, not a blank embed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    meAnswers = [pending, () => new Promise<Response>(() => {})];
    renderEmbed();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(loginVisits).toBe(0);
  });

  it.each([
    ['403 not_admin', () => json(403, { error: 'not_admin' }), 'UNAUTHORIZED'],
    ['401 signed out', () => json(401, {}), 'LOGIN'],
  ])('while the gate shows, a %s answer goes where FeatureGuard would send it', async (_label, answer, landing) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    meAnswers = [pending, pending, answer];
    renderEmbed();
    await screen.findByText('Checking your access…', { selector: 'p:not([role="status"])' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(await screen.findByText(landing)).toBeInTheDocument();
  });
});
