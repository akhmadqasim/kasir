import { createBrowserRouter, RouterProvider } from "react-router-dom"

const router = createBrowserRouter([
  {
    path: "/",
    element: <div className="flex items-center justify-center h-screen"><h1 className="text-2xl font-bold">POS Toko Sembako</h1></div>,
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
