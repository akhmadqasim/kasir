import { Component } from "react"
import type { ReactNode, ErrorInfo } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

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
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <div className="max-w-2xl rounded-lg border border-destructive/30 bg-card p-6 shadow-lg">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h1 className="text-xl font-bold text-destructive">Terjadi Error</h1>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {this.state.error?.message || "Unknown error"}
            </p>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
              {this.state.error?.stack}
            </pre>
            <Button
              variant="destructive"
              size="sm"
              className="mt-4"
              onClick={() => {
                this.setState({ hasError: false, error: null, errorInfo: null })
                window.location.hash = "/"
                window.location.reload()
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Muat Ulang
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
