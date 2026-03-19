import { AppProviders } from "@/app/providers"
import { AppRouter } from "@/app/router"
import { ErrorBoundary } from "@/app/error-boundary"
import { Toaster } from "@/components/ui/sonner"

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppRouter />
        <Toaster />
      </AppProviders>
    </ErrorBoundary>
  )
}

export default App
