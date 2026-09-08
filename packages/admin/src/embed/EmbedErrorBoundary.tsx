import { Component, ReactNode } from 'react';
import type { GwEmbedFatalError } from './types';
import { sanitizeMessage } from './sanitize';

interface Props {
  children: ReactNode;
  onFatal?: (err: GwEmbedFatalError) => void;
}

interface State {
  crashed: boolean;
}

/**
 * Classic React error boundary for the embed root. RootErrorBoundary
 * (src/app/pages/errors/RootErrorBoundary.tsx) only catches route-level
 * errors via react-router's ErrorBoundary mechanism, which doesn't cover
 * errors thrown by the provider stack itself (before RouterProvider even
 * renders) — this boundary sits above that and is the backstop the spec
 * calls for: a render crash reports through onFatal instead of taking
 * down the host page.
 */
export class EmbedErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onFatal?.({
      error_type: 'render_crash',
      code: 'gw_render_crash',
      message: sanitizeMessage(error),
      recoverable: false,
    });
  }

  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}
