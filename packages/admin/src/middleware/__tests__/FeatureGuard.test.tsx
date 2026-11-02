// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real AuthProvider and FeatureGuard; only the services under them are
// faked. Pins where a signed-in non-admin lands, standalone and embedded.
const getCurrentUser = vi.fn();
const sendMagicLink = vi.fn();
const signOut = vi.fn();
let embedded = false;
let authListener: ((user: unknown, outcome: string, sessionUserId?: string) => void | Promise<void>) | null = null;

vi.mock('@/utils/supabaseAuth', () => ({
  SupabaseAuthService: {
    onAuthStateChange: (cb: typeof authListener) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getCurrentUser: () => getCurrentUser(),
    signOut: () => signOut(),
    sendMagicLink: (email: string) => sendMagicLink(email),
  },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'auth-1', email: 'x@example.org' } } } }),
    },
  },
  isHostSession: () => false,
}));
vi.mock('@/embed/embedMode', () => ({ isEmbedded: () => embedded }));
vi.mock('@/utils/impersonationService', () => ({ ImpersonationService: {} }));
vi.mock('@/hooks/usePermissions', () => ({
  useHasPermission: () => ({ hasPermission: false, loading: false }),
}));
vi.mock('@/app/router/AccessDeniedRedirect', () => ({
  AccessDeniedRedirect: () => <div>ACCESS-DENIED-REDIRECT</div>,
}));

const { AuthProvider } = await import('@/app/contexts/auth/Provider');
const { useAuthContext } = await import('@/app/contexts/auth/context');

let goTo: ((path: string) => void) | null = null;
let login: ((c: { email: string }) => Promise<void>) | null = null;
let logout: (() => Promise<void>) | null = null;
function Controls() {
  const navigate = useNavigate();
  goTo = navigate;
  ({ login, logout } = useAuthContext());
  return null;
}
const { FeatureGuard } = await import('../FeatureGuard');

function renderGuarded() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/newsletters']}>
        <Controls />
        <Routes>
          <Route path="/newsletters" element={<FeatureGuard feature="newsletters"><div>SECRET</div></FeatureGuard>} />
          <Route path="/login" element={<div>LOGIN</div>} />
          <Route path="/unauthorized" element={<div>UNAUTHORIZED</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  embedded = false;
  authListener = null;
  sendMagicLink.mockReset();
  getCurrentUser.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('where a signed-in non-admin lands', () => {
  it('embedded: /unauthorized, never /login (the host must not start a sign-in round trip)', async () => {
    embedded = true;
    getCurrentUser.mockResolvedValue({ user: null, error: 'You do not have admin access.', reason: 'not_admin' });
    renderGuarded();

    expect(await screen.findByText('UNAUTHORIZED')).toBeInTheDocument();
    expect(screen.queryByText('LOGIN')).not.toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('standalone: /login, where the sign-in page explains it', async () => {
    getCurrentUser.mockResolvedValue({ user: null, error: 'You do not have admin access.', reason: 'not_admin' });
    renderGuarded();

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('embedded, but no user behind the session: /login as before', async () => {
    embedded = true;
    getCurrentUser.mockResolvedValue({ user: null, error: null, reason: 'no_user' });
    renderGuarded();

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });
});

describe('accessDenied is not sticky', () => {
  const NOT_ADMIN = { user: null, error: 'You do not have admin access.', reason: 'not_admin' };

  it('embedded: not_admin, then a sign-out, then the guarded page again -> /login', async () => {
    embedded = true;
    getCurrentUser.mockResolvedValue(NOT_ADMIN);
    renderGuarded();
    await screen.findByText('UNAUTHORIZED');

    await act(async () => {
      await authListener!(null, 'signed_out', 'auth-1');
    });
    act(() => goTo!('/newsletters'));

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('embedded: not_admin, then a fresh INITIALIZE (magic link sent), then the guarded page -> /login', async () => {
    embedded = true;
    getCurrentUser.mockResolvedValue(NOT_ADMIN);
    sendMagicLink.mockResolvedValue({ success: true, message: 'sent' });
    renderGuarded();
    await screen.findByText('UNAUTHORIZED');

    await act(async () => {
      await login!({ email: 'x@example.org' });
    });
    act(() => goTo!('/newsletters'));

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
  });

  it('embedded: not_admin, then a plain LOGOUT (sign-out that threw), then the guarded page -> /login', async () => {
    embedded = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost/apps/gw' });
    getCurrentUser.mockResolvedValue(NOT_ADMIN);
    signOut.mockRejectedValue(new Error('boom'));
    renderGuarded();
    await screen.findByText('UNAUTHORIZED');

    await act(async () => {
      await logout!();
    });
    act(() => goTo!('/newsletters'));

    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('embedded: a not_admin listener event after sign-in lands on /unauthorized', async () => {
    embedded = true;
    getCurrentUser.mockResolvedValue({
      user: { id: 'p1', email: 'x@example.org', name: 'X', role: 'admin', is_active: true, created_at: '', updated_at: '' },
      error: null,
    });
    renderGuarded();
    // Signed in, but the mocked permission says no, so the guard is on the
    // access-denied redirect; what matters is where a later not_admin goes.
    await screen.findByText('ACCESS-DENIED-REDIRECT');

    await act(async () => {
      await authListener!(null, 'not_admin', 'auth-1');
    });

    expect(await screen.findByText('UNAUTHORIZED')).toBeInTheDocument();
  });
});
