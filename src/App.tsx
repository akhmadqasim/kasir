import { Toast } from "@heroui/react"
import { AppProviders } from "@/app/providers"
import { AppRouter } from "@/app/router"
import { ErrorBoundary } from "@/app/error-boundary"

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppRouter />
        <Toast.Provider placement="bottom end" />
      </AppProviders>
    </ErrorBoundary>
  )
}

export default App
