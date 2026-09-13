import { Component } from "react"
import type { ReactNode, ErrorInfo } from "react"

import { ErrorScreen } from "./error-screen"
import { resolveHomeAction } from "./route-error"

interface Props {
  children: ReactNode
}

interface State {
  error: unknown
  hasError: boolean
}

/**
 * Last stop before a white screen, for whatever throws *outside* the router:
 * the providers, the `Toast.Provider`, the router itself failing to mount.
 * Errors thrown by a route land on `RouteErrorPage` first and never reach here.
 *
 * Both draw the same `ErrorScreen`; the only difference is that there is no
 * router to navigate with at this level, so both actions go through
 * `window.location` — a hard reload is the right reset anyway when the tree
 * that failed is the one holding all the state.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, hasError: false }
  }

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const home = resolveHomeAction()

    return (
      <ErrorScreen
        error={this.state.error}
        homeLabel={home.label}
        onHome={() => window.location.assign(home.path)}
        onRetry={() => window.location.reload()}
      />
    )
  }
}
