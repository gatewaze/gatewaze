// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real AuthProvider and FeatureGuard; only the services under them are
// faked. Pins where a signed-in non-admin lands, standalone and embedded.
const getCurrentUser = vi.fn();
let embedded = false;

vi.mock('@/utils/supabaseAuth', () => ({
  SupabaseAuthService: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    getCurrentUser: () => getCurrentUser(),
    signOut: vi.fn(),
    sendMagicLink: vi.fn(),
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
const { FeatureGuard } = await import('../FeatureGuard');

function renderGuarded() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/newsletters']}>
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
