import { Component } from "react"
import type { ReactNode, ErrorInfo } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-red-50 p-8">
          <div className="max-w-2xl rounded-lg border border-red-200 bg-white p-6 shadow-lg">
            <h1 className="mb-2 text-xl font-bold text-red-600">Terjadi Error</h1>
            <p className="mb-4 text-sm text-red-800">
              {this.state.error?.message || "Unknown error"}
            </p>
            <pre className="max-h-64 overflow-auto rounded bg-red-50 p-3 text-xs text-red-700">
              {this.state.error?.stack}
            </pre>
            <button
              className="mt-4 rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              onClick={() => {
                this.setState({ hasError: false, error: null, errorInfo: null })
                window.location.hash = "/"
                window.location.reload()
              }}
            >
              Muat Ulang
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
