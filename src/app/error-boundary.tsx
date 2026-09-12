import { Component } from "react"
import type { ReactNode, ErrorInfo } from "react"
import { Alert, Button } from "@heroui/react"
import { RefreshCw } from "lucide-react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Last stop before a white screen. The cashier is standing at the counter with a
 * queue, so this screen has to say what broke, in Indonesian, and offer one button
 * that gets them back to work.
 */
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

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    window.location.hash = "/"
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-8">
        <Alert className="max-w-2xl" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Terjadi Error</Alert.Title>
            <Alert.Description>
              {this.state.error?.message || "Kesalahan tidak diketahui"}
            </Alert.Description>
            <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-default p-3 text-xs text-muted">
              {this.state.error?.stack}
            </pre>
            <Button className="mt-4" size="sm" variant="danger" onPress={this.handleReload}>
              <RefreshCw />
              Muat Ulang
            </Button>
          </Alert.Content>
        </Alert>
      </div>
    )
  }
}
