'use client'

/**
 * ShellErrorBoundary — wraps the shell content slot so a single module-view error shows a graceful
 * fallback instead of blanking the whole app (prototype GwErrorBoundary). Resets on route change
 * via the `resetKey` prop. Spec §10 / §14.1.
 */
import { Component, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  resetKey: string
  children: ReactNode
}
interface State {
  hasError: boolean
}

export class ShellErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: unknown) {
    // Log with the active route so it correlates with portal_shell_client_error (§16).
    console.error('[shell] view error', { resetKey: this.props.resetKey, error })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="gw-view-error">
          <span className="gw-view-error-ico">
            <Icon name="shield" size={24} />
          </span>
          <div className="gw-view-error-title">This view hit a snag</div>
          <p className="gw-view-error-text">
            Try another section from the menu or refresh — the rest of the app is unaffected.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

export default ShellErrorBoundary
