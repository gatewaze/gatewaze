// Types for the jest-dom matchers; test/setup.ts registers them at runtime.
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOT_ADMIN_CACHE_MS } from '@/lib/hostSession';

import type { HostStatus } from '@/lib/hostSession';

let hostSession = false;
const getHostStatus = vi.fn<() => Promise<HostStatus>>();
const signOut = vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));
const rpc = vi.fn(async () => ({ data: [{ id: 'lfid-auth', features: [] }] }));

// The page's data reads, as a chainable stub: platform_settings (logo) and the
// public_enabled_modules RPC.
const client = {
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  rpc,
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  auth: { signOut },
};

vi.mock('@/lib/supabase', async () => {
  const { signInUrl } = await import('@/lib/hostSession');
  return {
    getSupabase: () => client,
    isHostSession: () => hostSession,
    getHostStatus: () => getHostStatus(),
    signInUrl,
  };
});

let authErrorMessage: string | null = null;
vi.mock('@/app/contexts/auth/context', () => ({
  useAuthContext: () => ({ login: vi.fn(), errorMessage: authErrorMessage, isLoading: false }),
}));

// One sign-in provider module is enabled, so local mode shows the slot.
vi.mock('@/hooks/useModuleSlots', () => ({
  useModuleSlots: () => [{ name: 'lfid' }],
}));
vi.mock('@/components/ModuleSlot', () => ({
  ModuleSlot: () => <div data-testid="provider-slot" />,
}));
vi.mock('@/components/shared/GradientBackground', () => ({ default: () => null }));

const { default: SignIn } = await import('../index');
const { SIGN_IN_UNAVAILABLE_MESSAGE, signInErrorMessage } = await import('../signInErrors');

// The page also mounts a screen-reader-only live region that repeats the
// status, so text queries target the visible copy.
const VISIBLE = { selector: 'p:not([role="status"])' };
// ?error= messages render in an InputErrorMsg <span>.
const ERROR_TEXT = { selector: 'span' };

let assign: ReturnType<typeof vi.fn>;

function setUrl(search: string) {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, origin: window.location.origin, pathname: '/login', search, assign });
}

beforeEach(() => {
  hostSession = false;
  getHostStatus.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
  toastError.mockClear();
  rpc.mockClear();
  authErrorMessage = null;
  setUrl('');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignIn page, host-session mode', () => {
  beforeEach(() => {
    hostSession = true;
  });

  it('shows one Sign in button and hides the magic-link form and provider slot', async () => {
    getHostStatus.mockResolvedValue({ status: 'signed_out' });
    render(<SignIn />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('provider-slot')).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('starts the session holder sign-in with the redirect param', async () => {
    setUrl('?redirect=%2Fevents%2F42');
    getHostStatus.mockResolvedValue({ status: 'signed_out' });
    render(<SignIn />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2Fevents%2F42');
  });

  it('never forwards an off-site redirect param', async () => {
    setUrl('?redirect=%2F%2Fevil.example');
    getHostStatus.mockResolvedValue({ status: 'signed_out' });
    render(<SignIn />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2F');
  });

  it('explains a signed-in non-admin and offers sign out', async () => {
    getHostStatus.mockResolvedValue({ status: 'not_admin', email: 'someone@example.org' });
    render(<SignIn />);

    expect(await screen.findByText(/signed in as someone@example\.org, which does not have admin access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('never renders an unknown ?error= value, only a generic message', async () => {
    setUrl('?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%20call%20evil.example');
    getHostStatus.mockResolvedValue({ status: 'signed_out' });
    const { container } = render(<SignIn />);

    expect(await screen.findByText('Sign-in failed. Please try again.', ERROR_TEXT)).toBeInTheDocument();
    expect(container.textContent).not.toContain('evil.example');
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('maps a known ?error= code to its fixed message', async () => {
    setUrl('?error=access_denied');
    getHostStatus.mockResolvedValue({ status: 'signed_out' });
    render(<SignIn />);

    expect(await screen.findByText('Sign-in was cancelled or denied.', ERROR_TEXT)).toBeInTheDocument();
  });

  it('shows the unavailable state when the status check rejects', async () => {
    getHostStatus.mockRejectedValue(new Error('offline'));
    render(<SignIn />);

    expect(await screen.findByText(SIGN_IN_UNAVAILABLE_MESSAGE, VISIBLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('a later status check that rejects replaces the not-admin view with unavailable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getHostStatus
        .mockResolvedValueOnce({ status: 'not_admin', email: 'someone@example.org' })
        .mockRejectedValueOnce(new Error('offline'));
      render(<SignIn />);
      await screen.findByText(/does not have admin access/, VISIBLE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOT_ADMIN_CACHE_MS);
      });

      expect(await screen.findByText(SIGN_IN_UNAVAILABLE_MESSAGE, VISIBLE)).toBeInTheDocument();
      expect(screen.queryByText(/does not have admin access/, VISIBLE)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unavailable: Retry asks again, and navigates once access is confirmed', async () => {
    setUrl('?redirect=%2Fevents');
    getHostStatus.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValue({ status: 'ok', user: { id: 'u1' } as never });
    render(<SignIn />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/events'));
    expect(getHostStatus).toHaveBeenCalledTimes(2);
  });

  describe('timed re-checks', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('pending: shows "Checking your access…" without Sign out, polls after Retry-After, and navigates on ok', async () => {
      setUrl('?redirect=%2Fevents%2F42');
      getHostStatus
        .mockResolvedValueOnce({ status: 'pending', retryAfterMs: 1000 })
        .mockResolvedValue({ status: 'ok', user: { id: 'u1' } as never });
      render(<SignIn />);

      expect(await screen.findByText('Checking your access…', VISIBLE)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
      expect(getHostStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/events/42'));
    });

    it('pending: gives up after 5 polls and offers Retry', async () => {
      getHostStatus.mockResolvedValue({ status: 'pending', retryAfterMs: 1000 });
      render(<SignIn />);
      await screen.findByText('Checking your access…', VISIBLE);

      for (let i = 0; i < 6; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }

      expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(getHostStatus).toHaveBeenCalledTimes(6);
      expect(assign).not.toHaveBeenCalled();
    });

    it('pending then ok never navigates off-site (?redirect=//evil.example goes to /)', async () => {
      setUrl('?redirect=%2F%2Fevil.example');
      getHostStatus
        .mockResolvedValueOnce({ status: 'pending', retryAfterMs: 1000 })
        .mockResolvedValue({ status: 'ok', user: { id: 'u1' } as never });
      render(<SignIn />);
      await screen.findByText('Checking your access…', VISIBLE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    });

    it('Retry starts a fresh pending budget', async () => {
      getHostStatus.mockResolvedValue({ status: 'pending', retryAfterMs: 1000 });
      render(<SignIn />);
      await screen.findByText('Checking your access…', VISIBLE);
      for (let i = 0; i < 6; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(getHostStatus).toHaveBeenCalledTimes(6);

      fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      await screen.findByText('Checking your access…', VISIBLE);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Without the reset, the first check after Retry would exceed the cap
      // and go straight back to Retry without polling again.
      expect(getHostStatus).toHaveBeenCalledTimes(8);
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('not_admin: re-checks once after the cache window, then navigates if access arrived', async () => {
      getHostStatus
        .mockResolvedValueOnce({ status: 'not_admin', email: 'someone@example.org' })
        .mockResolvedValue({ status: 'ok', user: { id: 'u1' } as never });
      render(<SignIn />);
      await screen.findByText(/does not have admin access/, VISIBLE);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(NOT_ADMIN_CACHE_MS);
      });

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    });

    it('not_admin: re-checks only once, then settles', async () => {
      getHostStatus.mockResolvedValue({ status: 'not_admin', email: 'someone@example.org' });
      render(<SignIn />);
      await screen.findByText(/does not have admin access/, VISIBLE);

      // Three separate windows, so a guard that re-armed after every
      // not_admin would show up as extra checks.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(NOT_ADMIN_CACHE_MS);
        });
      }

      expect(getHostStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });
  });

  it('shows a neutral checking state, not the Sign in button, while the first check runs', async () => {
    getHostStatus.mockReturnValue(new Promise(() => {}));
    render(<SignIn />);

    expect(await screen.findByText('Checking your access…', VISIBLE)).toBeInTheDocument();
    expect(screen.getByText('Checking your access', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('does not navigate when the first check is already ok', async () => {
    getHostStatus.mockResolvedValue({ status: 'ok', user: { id: 'u1' } as never });
    render(<SignIn />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['not_admin', { status: 'not_admin' as const }, 'No admin access'],
    ['unavailable', { status: 'unavailable' as const }, 'Sign-in unavailable'],
    ['signed_out', { status: 'signed_out' as const }, 'Sign in to continue'],
  ])('the heading matches the %s state', async (_label, status, heading) => {
    getHostStatus.mockResolvedValue(status);
    render(<SignIn />);

    expect(await screen.findByText(heading, { selector: 'p' })).toBeInTheDocument();
  });

  it('announces the state through a live region', async () => {
    getHostStatus.mockResolvedValue({ status: 'unavailable' });
    render(<SignIn />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SIGN_IN_UNAVAILABLE_MESSAGE));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('moves focus to the heading after Retry removes the focused button', async () => {
    getHostStatus.mockResolvedValueOnce({ status: 'unavailable' }).mockReturnValue(new Promise(() => {}));
    render(<SignIn />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    retry.focus();

    fireEvent.click(retry);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Checking your access', { selector: 'p' })));
  });

  it('shows a busy Sign out while the call runs, then focuses the heading', async () => {
    getHostStatus.mockResolvedValue({ status: 'not_admin', email: 'someone@example.org' });
    let finish: (v: { error: Error | null }) => void = () => {};
    signOut.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SignIn />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    const busy = await screen.findByRole('button', { name: 'Signing out…' });
    expect(busy).toBeDisabled();

    await act(async () => finish({ error: null }));

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByText('Sign in to continue', { selector: 'p' }));
  });

  it('uses one wording for "unavailable" in the view and for ?error=server_error', async () => {
    expect(signInErrorMessage('server_error')).toBe(SIGN_IN_UNAVAILABLE_MESSAGE);
  });

  it('keeps the not-admin view and tells the user when sign-out fails', async () => {
    getHostStatus.mockResolvedValue({ status: 'not_admin', email: 'someone@example.org' });
    signOut.mockResolvedValue({ error: new Error('Sign-out failed (500)') });
    render(<SignIn />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Sign-out did not complete'));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('SignIn page, local mode (unchanged)', () => {
  it('shows the not-admin reason in the provider-only (SSO) layout too', async () => {
    authErrorMessage = 'You do not have admin access. Please contact your administrator.';
    render(<SignIn />);

    expect(await screen.findByTestId('provider-slot')).toBeInTheDocument();
    expect(screen.getByText('You do not have admin access. Please contact your administrator.')).toBeInTheDocument();
  });

  it('renders the provider slot and never asks the session holder', async () => {
    render(<SignIn />);

    expect(await screen.findByTestId('provider-slot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(getHostStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('public_enabled_modules'));
  });
});

describe('signInErrorMessage', () => {
  it.each([
    ['access_denied', 'Sign-in was cancelled or denied.'],
    ['login_failed', 'Sign-in did not complete. Please try again.'],
    ['callback_invalid', 'Your sign-in link expired or was already used. Please try again.'],
    ['not_admin', 'Your account does not have admin access.'],
    ['server_error', 'Sign-in is temporarily unavailable. Please try again.'],
  ])('maps %s', (code, message) => {
    expect(signInErrorMessage(code)).toBe(message);
  });

  it.each(['sign-in is unavailable', '__proto__', 'constructor', 'toString', ''])('falls back for %j', (code) => {
    expect(signInErrorMessage(code)).toBe('Sign-in failed. Please try again.');
  });
});
