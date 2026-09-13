import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    /**
     * The dev app keeps its data under `data/` in the project root — the
     * SQLite file, backups, and the WhatsApp sidecar's browser profile, which
     * Edge rewrites constantly. None of it is source; without the ignore every
     * profile write was a full page reload.
     */
    watch: { ignored: ["**/data/**", "**/src-tauri/**", "**/sidecar/**/dist/**"] },
    /**
     * `bun run dev` serves the SPA from 5173 while the API lives inside the
     * running application on 17720, so the two are different origins and the
     * client's relative `/api` paths would 404. Proxying keeps them one origin
     * from the browser's point of view, which also keeps the `Origin` header
     * the server's CSRF check reads pointed at 5173.
     *
     * `changeOrigin` stays off deliberately: rewriting the `Host` header would
     * make the server expect an `Origin` of `127.0.0.1:17720` and reject every
     * write. Run the app with
     * `KASIR_ALLOWED_ORIGINS=http://localhost:5173` to let the dev server's
     * origin through. A production build needs none of this: it is served by
     * the same process as the API.
     */
    proxy: {
      "/api": {
        target: "http://127.0.0.1:17720",
        changeOrigin: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
