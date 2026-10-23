import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIRST_PAINT_EVENT } from '../contract';
import { armFirstPaint, disarmFirstPaint, signalFirstPaint } from '../firstPaint';
import type { GwHostContext } from '../types';

// EmbedApp's own job here: the router's HydrateFallback while a lazy route
// loads, and the first-paint signal. The provider stack is passed through.
const pass = ({ children }: { children: ReactNode }) => <>{children}</>;
vi.mock('@/app/contexts/auth/Provider', () => ({ AuthProvider: pass }));
vi.mock('@/app/contexts/breakpoint/Provider', () => ({ BreakpointProvider: pass }));
vi.mock('@/app/contexts/sidebar/Provider', () => ({ SidebarProvider: pass }));
vi.mock('@/app/contexts/theme/Provider', () => ({ ThemeProvider: pass }));
vi.mock('@/app/contexts/theme/RadixThemeBridge', () => ({ RadixThemeBridge: pass }));
vi.mock('../EmbedModulesProvider', () => ({ EmbedModulesProvider: pass }));
vi.mock('@/components/template/Toaster', () => ({ default: () => null }));
vi.mock('@/components/template/Tooltip', () => ({ default: () => null }));

let releaseRoute: (() => void) | null = null;
vi.mock('@/app/router/moduleRoutes', () => ({
  moduleRoutes: [
    // Already loaded: no fallback renders, so the root layout must signal.
    { path: 'eager', element: <div>EAGER</div> },
    {
      path: 'newsletters',
      lazy: () =>
        new Promise((resolve) => {
          releaseRoute = () => resolve({ Component: () => <div>NEWSLETTERS</div> });
        }),
    },
  ],
  moduleAdminRoutes: [],
  moduleBareRoutes: [],
}));

const { EmbedApp } = await import('../EmbedApp');

const ctx = {
  basename: '/gw',
  supabase: { url: 'https://x.test', anonKey: 'a' },
  apiBaseUrl: '',
  enabled: { moduleIds: [], features: [] },
} as GwHostContext;

beforeEach(() => {
  releaseRoute = null;
  window.history.pushState({}, '', '/gw/newsletters');
});

afterEach(() => {
  disarmFirstPaint();
});

describe('EmbedApp while a lazy route loads', () => {
  it('shows the page spinner instead of nothing, signals first paint once, then renders the route', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onPaint = vi.fn();
    const onSignal = vi.fn();
    container.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(container, onSignal);

    render(<EmbedApp ctx={ctx} container={container} />, { container });

    expect(screen.getByRole('status')).toHaveClass('py-16');
    expect(screen.queryByText('NEWSLETTERS')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(onPaint).toHaveBeenCalledTimes(1));
    expect(onSignal).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(releaseRoute).not.toBeNull());
    await act(async () => releaseRoute!());
    expect(await screen.findByText('NEWSLETTERS')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The root layout mounting afterwards does not signal again.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onPaint).toHaveBeenCalledTimes(1);
    container.remove();
  });
});

describe('EmbedApp on a route whose code is already loaded', () => {
  it('signals first paint from the root layout, once', async () => {
    window.history.pushState({}, '', '/gw/eager');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onPaint = vi.fn();
    container.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(container);

    render(<EmbedApp ctx={ctx} container={container} />, { container });

    expect(await screen.findByText('EAGER')).toBeInTheDocument();
    await vi.waitFor(() => expect(onPaint).toHaveBeenCalledTimes(1));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onPaint).toHaveBeenCalledTimes(1);
    container.remove();
  });
});

describe('signalFirstPaint', () => {
  it('a signal already waiting for its frame is cancelled by disarm (unmount)', async () => {
    const el = document.createElement('div');
    const onPaint = vi.fn();
    const onSignal = vi.fn();
    el.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(el, onSignal);
    signalFirstPaint();
    disarmFirstPaint();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onPaint).not.toHaveBeenCalled();
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('signals straight away in a hidden tab, which runs no animation frames', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const el = document.createElement('div');
    const onPaint = vi.fn();
    el.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(el);
    signalFirstPaint();
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    visibility.mockRestore();
    raf.mockRestore();
  });

  it('does nothing when nothing is armed (standalone)', () => {
    expect(() => signalFirstPaint()).not.toThrow();
  });

  it('does nothing after disarm (unmounted before the first paint)', async () => {
    const el = document.createElement('div');
    const onPaint = vi.fn();
    el.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(el);
    disarmFirstPaint();
    signalFirstPaint();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onPaint).not.toHaveBeenCalled();
  });

  it('survives an onSignal that throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const onPaint = vi.fn();
    el.addEventListener(FIRST_PAINT_EVENT, onPaint);
    armFirstPaint(el, () => {
      throw new Error('sink');
    });
    signalFirstPaint();
    await vi.waitFor(() => expect(onPaint).toHaveBeenCalledTimes(1));
    expect(console.warn).toHaveBeenCalled();
  });
});
