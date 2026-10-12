// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser, AuthChangeOutcome } from '@/utils/supabaseAuth';

type Listener = (user: AdminUser | null, outcome: AuthChangeOutcome, sessionUserId?: string) => void | Promise<void>;

let authListener: Listener | null = null;
const getSession = vi.fn();
const getCurrentUser = vi.fn();
const signOut = vi.fn(async (): Promise<{ error: string | null }> => ({ error: null }));
const startImpersonation = vi.fn();
let hostSession = false;
let embedded = false;

vi.mock('@/utils/supabaseAuth', () => ({
  SupabaseAuthService: {
    onAuthStateChange: (cb: Listener) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getCurrentUser: () => getCurrentUser(),
    signOut: () => signOut(),
    sendMagicLink: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
  isHostSession: () => hostSession,
}));

vi.mock('@/embed/embedMode', () => ({
  isEmbedded: () => embedded,
}));

vi.mock('@/utils/impersonationService', () => ({
  ImpersonationService: {
    startImpersonation: (...args: unknown[]) => startImpersonation(...args),
  },
}));

const { AuthProvider } = await import('../Provider');
const { useAuthContext } = await import('../context');

const ADMIN: AdminUser = {
  id: 'admin-1',
  email: 'admin@example.org',
  name: 'Admin',
  role: 'admin',
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const OTHER: AdminUser = { ...ADMIN, id: 'admin-2', email: 'other@example.org', name: 'Other' };

let ctx: ReturnType<typeof useAuthContext> | null = null;
let renders = 0;

function Probe() {
  ctx = useAuthContext();
  renders += 1;
  return (
    <div>
      <span data-testid="init">{String(ctx.isInitialized)}</span>
      <span data-testid="auth">{String(ctx.isAuthenticated)}</span>
      <span data-testid="email">{ctx.user?.email ?? ''}</span>
      <span data-testid="impersonating">{String(ctx.impersonation.isImpersonating)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

async function fire(user: AdminUser | null, outcome: AuthChangeOutcome, sessionUserId?: string) {
  await act(async () => {
    await authListener!(user, outcome, sessionUserId);
  });
}

// The auth (GoTrue) user id behind an admin profile in these tests.
const authIdOf = (user: AdminUser) => `auth-${user.id}`;

async function signedInAs(user: AdminUser) {
  getSession.mockResolvedValue({ data: { session: { user: { id: authIdOf(user), email: user.email } } } });
  getCurrentUser.mockResolvedValue({ user, error: null });
  renderProvider();
  await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('true'));
}

beforeEach(() => {
  authListener = null;
  hostSession = false;
  embedded = false;
  ctx = null;
  renders = 0;
  getSession.mockReset();
  getCurrentUser.mockReset();
  startImpersonation.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AuthProvider auth listener', () => {
  it('handles a sign-out event that arrives after initialization', async () => {
    await signedInAs(ADMIN);

    // Regression: the listener read the first render's isInitialized
    // (false) and dropped every event after start-up, so a session that
    // expired mid-use never signed the admin out.
    await fire(null, 'signed_out');

    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('handles a sign-in event that arrives after initialization', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('true'));
    expect(screen.getByTestId('auth')).toHaveTextContent('false');

    await fire(ADMIN, 'signed_in');

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('admin@example.org');
  });

  it('still ignores events before initialization completes', async () => {
    let resolveSession: (v: unknown) => void = () => {};
    getSession.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)));
    renderProvider();

    await fire(ADMIN, 'signed_in');
    expect(screen.getByTestId('auth')).toHaveTextContent('false');

    await act(async () => resolveSession({ data: { session: null } }));
    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('logs out on a definite not_admin result', async () => {
    await signedInAs(ADMIN);

    await fire(null, 'not_admin');

    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('does not log out when the profile lookup failed (network, transient DB error)', async () => {
    await signedInAs(ADMIN);

    await fire(null, 'lookup_failed');

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('admin@example.org');
  });

  it('ignores a repeated SIGNED_IN for the same user (no re-render)', async () => {
    await signedInAs(ADMIN);
    const before = renders;

    await fire({ ...ADMIN }, 'signed_in');

    expect(renders).toBe(before);
  });

  it('switches to a different user on SIGNED_IN', async () => {
    await signedInAs(ADMIN);

    await fire(OTHER, 'signed_in');

    expect(screen.getByTestId('email')).toHaveTextContent('other@example.org');
  });

  it('keeps an active impersonation when the same user signs in again', async () => {
    await signedInAs(ADMIN);
    startImpersonation.mockResolvedValue({ success: true, session: { id: 's1' }, impersonatedUser: OTHER });
    await act(async () => {
      await ctx!.startImpersonation(OTHER.id);
    });
    expect(screen.getByTestId('impersonating')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('other@example.org');

    await fire({ ...ADMIN }, 'signed_in');

    expect(screen.getByTestId('impersonating')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('other@example.org');
  });

  it('applies an edited profile for the same user without ending impersonation', async () => {
    await signedInAs(ADMIN);
    startImpersonation.mockResolvedValue({ success: true, session: { id: 's1' }, impersonatedUser: OTHER });
    await act(async () => {
      await ctx!.startImpersonation(OTHER.id);
    });

    await fire({ ...ADMIN, name: 'Renamed', role: 'super_admin' }, 'signed_in', authIdOf(ADMIN));

    expect(screen.getByTestId('impersonating')).toHaveTextContent('true');
    expect(ctx!.impersonation.originalUser).toMatchObject({ name: 'Renamed', role: 'super_admin' });
    expect(screen.getByTestId('email')).toHaveTextContent('other@example.org');
  });

  it('applies an edited profile for the same user when not impersonating', async () => {
    await signedInAs(ADMIN);

    await fire({ ...ADMIN, name: 'Renamed' }, 'signed_in', authIdOf(ADMIN));

    expect(ctx!.user?.name).toBe('Renamed');
  });

  it('a different user signing in while impersonating ends the impersonation', async () => {
    await signedInAs(ADMIN);
    startImpersonation.mockResolvedValue({ success: true, session: { id: 's1' }, impersonatedUser: OTHER });
    await act(async () => {
      await ctx!.startImpersonation(OTHER.id);
    });
    const THIRD = { ...ADMIN, id: 'admin-3', email: 'third@example.org' };

    await fire(THIRD, 'signed_in', authIdOf(THIRD));

    expect(screen.getByTestId('impersonating')).toHaveTextContent('false');
    expect(screen.getByTestId('email')).toHaveTextContent('third@example.org');
  });

  it('logs out when a different user signs in and their lookup fails', async () => {
    await signedInAs(ADMIN);

    await fire(null, 'lookup_failed', authIdOf(OTHER));

    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('keeps the same user when their lookup fails', async () => {
    await signedInAs(ADMIN);

    await fire(null, 'lookup_failed', authIdOf(ADMIN));

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
  });

  it('handles events after the failsafe timeout initialized the provider', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSession.mockReturnValue(new Promise(() => {}));
    renderProvider();
    await act(async () => vi.advanceTimersByTime(3000));

    await fire(ADMIN, 'signed_in');

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
  });

  it('handles events after an initialization error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getSession.mockRejectedValue(new Error('boom'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('true'));

    await fire(ADMIN, 'signed_in');

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
  });
});

describe('AuthProvider initialization honours the profile lookup', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'auth-1', email: 'x@example.org' } } } });
  });

  it('a signed-in non-admin stays signed out and sees why', async () => {
    getCurrentUser.mockResolvedValue({ user: null, error: 'You do not have admin access.', reason: 'not_admin' });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('true'));

    expect(screen.getByTestId('auth')).toHaveTextContent('false');
    expect(ctx!.errorMessage).toBe('You do not have admin access.');
  });

  it('no user behind the session stays signed out', async () => {
    getCurrentUser.mockResolvedValue({ user: null, error: null, reason: 'no_user' });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('true'));

    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('a failed lookup keeps the basic-session fallback and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCurrentUser.mockResolvedValue({ user: null, error: 'timeout', reason: 'lookup_failed' });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('init')).toHaveTextContent('true'));

    expect(screen.getByTestId('auth')).toHaveTextContent('true');
    expect(screen.getByTestId('email')).toHaveTextContent('x@example.org');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lookup failed'), 'timeout');
  });
});

describe('AuthProvider initialization failsafe', () => {
  it('gives up after 3s in local mode', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSession.mockReturnValue(new Promise(() => {}));
    renderProvider();

    await act(async () => vi.advanceTimersByTime(3000));

    expect(screen.getByTestId('init')).toHaveTextContent('true');
  });

  it('waits longer in host-session mode, where getSession is a network round trip', async () => {
    hostSession = true;
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSession.mockReturnValue(new Promise(() => {}));
    renderProvider();

    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('init')).toHaveTextContent('false');

    await act(async () => vi.advanceTimersByTime(7000));
    expect(screen.getByTestId('init')).toHaveTextContent('true');
  });
});

describe('AuthProvider logout', () => {
  function stubLocation() {
    const loc = { ...window.location, href: 'http://localhost/apps/gw' };
    vi.stubGlobal('location', loc);
    return loc;
  }

  // Starts signed in, so the LOGOUT dispatch is observable.
  async function ready() {
    const loc = stubLocation();
    await signedInAs(ADMIN);
    return loc;
  }

  it('navigates to /login in the standalone admin', async () => {
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(signOut).toHaveBeenCalled();
    expect(loc.href).toBe('/login');
  });

  it('navigates to /login in the standalone host-session admin', async () => {
    hostSession = true;
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('/login');
  });

  it('navigates to /login when embedded with a localStorage session', async () => {
    embedded = true;
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('/login');
  });

  it('does not navigate when embedded with a host-held session', async () => {
    hostSession = true;
    embedded = true;
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(signOut).toHaveBeenCalled();
    expect(loc.href).toBe('http://localhost/apps/gw');
    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('embedded host-session: the catch path does not navigate either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hostSession = true;
    embedded = true;
    signOut.mockRejectedValue(new Error('boom'));
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('http://localhost/apps/gw');
    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('local mode: a sign-out error still navigates to /login, as before', async () => {
    signOut.mockResolvedValue({ error: 'network' });
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('/login');
  });

  it('host-session: a failed sign-out does not reload into /login', async () => {
    hostSession = true;
    signOut.mockResolvedValue({ error: 'Sign-out failed (500)' });
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('http://localhost/apps/gw');
    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });

  it('still logs out and navigates when signOut throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signOut.mockRejectedValue(new Error('boom'));
    const loc = await ready();

    await act(async () => ctx!.logout());

    expect(loc.href).toBe('/login');
    expect(screen.getByTestId('auth')).toHaveTextContent('false');
  });
});
