import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Setiap file test membangun jsdom sendiri lalu memuat bundel HeroUI yang
    // berat. Satu worker per core membuat mereka berebut CPU sampai `findBy*`
    // kehabisan waktu — dan file yang gagal berpindah-pindah tiap run. Setengah
    // core menghabiskan suite ini lebih cepat, bukan lebih lambat, karena tidak
    // ada waktu terbuang untuk saling menunggu.
    maxWorkers: "50%",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
