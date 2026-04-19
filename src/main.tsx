import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"
import { installGlobalErrorHandlers, logger } from "@/lib/startup-logger"

installGlobalErrorHandlers()
logger.startup("Frontend main.tsx executing")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
