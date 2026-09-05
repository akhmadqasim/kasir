# Desain: Mode Web (LAN + nginx), Refactor Backend, Migrasi HeroUI v3

Tanggal: 2026-09-05
Status: disetujui untuk eksekusi (jalan terus, commit per fase, branch `worktree-web-heroui`)
Worktree: `E:\kasir\.claude\worktrees\web-heroui`

## 1. Tujuan

Tiga pekerjaan yang digabung dalam satu jalur refactor besar:

1. **Bug hunt + clean code.** Codebase sebelumnya ditulis sebagian besar oleh ChatGPT Codex. Cari bug nyata, perbaiki, rapikan struktur. Refactor besar diperbolehkan.
2. **Dual-mode akses.** Aplikasi tetap jalan sebagai app desktop Tauri, tapi juga bisa dibuka dari browser perangkat lain di LAN toko lewat nginx.
3. **Migrasi UI.** shadcn/ui + Radix → HeroUI v3 (`@heroui/react` 3.2.4, Tailwind v4, React Aria Components).

## 2. Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Siapa yang akses lewat browser | Perangkat lain di LAN toko (tablet/HP/PC kasir kedua) |
| Di mana backend jalan | App Tauri di PC kasir sekaligus jadi HTTP server (axum embedded) |
| Transport frontend→backend | HTTP-only, satu jalur kode. Webview Tauri juga load dari `http://127.0.0.1:PORT` |
| Eksekusi | Jalan terus tanpa berhenti, satu commit per fase, `master` tidak disentuh |

Konsekuensi langsung dari "HTTP-only": **seluruh 117 Tauri command dihapus**, diganti route HTTP. Tidak ada percabangan `invoke` vs `fetch`, tidak ada dua model auth, tidak ada dua jalur yang harus dites.

## 3. Kondisi awal (baseline terukur)

| Item | Nilai |
|---|---|
| Frontend LOC (ts/tsx) + backend (rs) | ~39.900 baris |
| Tauri command terdaftar | 117 |
| File frontend yang import `@tauri-apps/*` | 22 |
| Vitest | 123 test, 6 file, semua hijau |
| `cargo test --lib` | **gagal compile**, 7 error `missing field payment_breakdown` di fixture test `transactions.rs` |
| ESLint | 3 error, 1 warning |
| Prettier | 186 file tidak sesuai format |
| `tsc -b` | bersih |
| Tauri | 2.10.3, sea-orm 1.1.19, sqlx 0.8.6, Rust 1.94 |

Angka-angka itu jadi acuan: di akhir pekerjaan, `cargo test`, `bun run test`, `bun run lint`, `bunx prettier --check`, dan `tsc -b` harus semuanya hijau.

## 4. Arsitektur target

### 4.1 Backend: tiga lapis

```
src-tauri/src/
├── main.rs, lib.rs        # bootstrap: db → server → window Tauri
├── domain/                # tipe input/output murni (serde), tanpa axum & tanpa tauri
├── services/              # SELURUH business logic. Signature: (&Db, Actor, Input) -> Result<Out, AppError>
│   ├── auth.rs  products.rs  categories.rs  transactions.rs  refunds.rs
│   ├── stock.rs  shifts.rs  reports.rs  dashboard.rs  settings.rs
│   ├── backup.rs  receipt.rs  onboarding.rs  ppob/
├── http/                  # lapis transport SATU-SATUNYA
│   ├── mod.rs             # bind, router, graceful shutdown
│   ├── session.rs         # session store + cookie
│   ├── middleware.rs      # auth extractor, role guard, origin check, rate limit
│   ├── error.rs           # AppError -> HTTP status + body JSON
│   ├── routes/            # handler tipis: parse → panggil service → JSON
│   └── static_files.rs    # rust-embed: serve dist/ + SPA fallback
├── db/  entity/  printing/  utils/
```

Aturan keras: `services/` tidak boleh import `axum` maupun `tauri`. Handler HTTP tidak boleh berisi query SQL atau aturan bisnis. Itu yang membuat business logic bisa dites dengan `cargo test` tanpa server.

### 4.2 Server HTTP

- **axum 0.8** + `tower-http` (CORS, compression, trace, limit body).
- Bind `0.0.0.0` di port default **17720**; kalau terpakai, coba 17721..17729. Port final ditulis ke log startup dan dipakai untuk URL window Tauri.
- Static: `rust-embed` embed folder `dist/` ke binary. Route `/` dan semua path non-`/api` → `index.html` (SPA fallback), aset dengan `Cache-Control` panjang + hash Vite.
- Window Tauri dibuat **programatik di `setup()`** setelah server bind, pakai `WebviewWindowBuilder` + `WebviewUrl::External("http://127.0.0.1:<port>")`. Definisi window statis di `tauri.conf.json` dihapus karena port baru diketahui saat runtime.
- Plugin `tauri-plugin-dialog` dan `tauri-plugin-shell` dihapus (tidak ada lagi pemakainya).

### 4.3 Auth: session server-side

Ini bagian paling penting. Sekarang frontend mengirim `callerId`/`userId` dan backend mempercayainya — 49 call-site. Begitu dibuka ke LAN, siapa pun bisa mengirim `callerId: 1` dan jadi admin.

- Migration baru `016_sessions.sql`: tabel `sessions(id TEXT PRIMARY KEY, user_id, created_at, last_seen_at, expires_at, user_agent, ip)`.
- `POST /api/auth/login` → verifikasi bcrypt → buat token acak 256-bit (`rand`), simpan **hash SHA-256**-nya, kirim cookie `kasir_session` dengan `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` bila request datang lewat HTTPS.
- Middleware `require_auth` mengambil session → user aktif → menaruh `Actor { user_id, role }` di request extensions. Semua service menerima `Actor`, **tidak pernah** id dari body.
- `require_admin` sebagai layer terpisah untuk route admin.
- `GET /api/auth/me` untuk boot frontend, `POST /api/auth/logout` menghapus session.
- Rate limit login per-username + per-IP (backoff bertingkat), karena PIN hanya 4-6 digit.
- Origin/Referer check pada semua request yang mengubah state (mitigasi CSRF, melengkapi `SameSite=Lax`).
- Sesi kedaluwarsa mengikuti `security.session_timeout_minutes` yang sudah ada di app settings, dengan sliding expiry.

### 4.4 Peta route HTTP

Satu route per command lama, dikelompokkan per resource. Pola: `GET` untuk baca, `POST` untuk aksi/buat, `PATCH` untuk ubah sebagian, `DELETE` untuk hapus.

| Prefix | Isi | Role |
|---|---|---|
| `/api/auth` | login, logout, me | publik untuk login |
| `/api/onboarding` | status, complete | publik saat belum ada store |
| `/api/users` | list, create, update, toggle-active | admin |
| `/api/products` | search, by-barcode, CRUD, popular, pin, bulk, template | kasir baca, admin tulis |
| `/api/categories` | CRUD | admin tulis |
| `/api/transactions` | checkout, list, detail, delete, payment-method, receipt-number, retry-ppob | kasir |
| `/api/refunds` | create, list, detail | kasir |
| `/api/stock/writeoffs` | list, create, approve, reject, delete, detail | kasir sebagian, admin untuk `lost` |
| `/api/shifts` | open, active, close, summary, cash-flows | kasir |
| `/api/reports/*` | 11 laporan | sesuai aturan lama |
| `/api/dashboard/*` | 7 endpoint ringkasan | kasir |
| `/api/settings` | store-info, app-settings, pin, database-info | admin untuk tulis |
| `/api/backup` | list, create, restore, delete, **export (download)**, **import (upload multipart)** | admin |
| `/api/printers` | list, print, test, settings | kasir |
| `/api/ppob/*` | 24 endpoint | kasir |
| `/api/logs` | write entry, dirs | internal |

Dua perubahan bentuk karena tidak ada lagi dialog file Tauri:
- Export DB: `GET /api/backup/export` mengalirkan file `.db` sebagai unduhan browser (`Content-Disposition`), bukan menulis ke path yang dikirim client. Ini sekaligus menutup celah path traversal.
- Import DB dan template produk: upload multipart, disimpan ke direktori data yang dikontrol server. Nama file dari client tidak pernah dipakai sebagai path.

### 4.5 Frontend

- `src/lib/api/client.ts`: satu `fetch` wrapper. `credentials: "include"`, `Content-Type: application/json`, mengubah body error server jadi `ApiError` bertipe, 401 → redirect ke `/login`.
- `src/lib/api/<resource>.ts`: fungsi bertipe per endpoint. Tidak ada komponen yang memanggil `fetch` langsung.
- `src/hooks/use-tauri-command.ts` dihapus; diganti `useApiQuery` / `useApiMutation` tipis di atas TanStack Query dengan query key terstruktur (`["products","search",params]`) supaya invalidasi setelah mutasi benar.
- Router: `createHashRouter` → `createBrowserRouter` (SPA fallback sudah disiapkan axum dan nginx).
- Auth store Zustand berhenti jadi sumber kebenaran. Boot memanggil `/api/auth/me`; store hanya cache tampilan. `localStorage` tidak lagi menyimpan identitas.
- `startup-logger` mengirim log lewat HTTP, dengan buffer supaya kegagalan log tidak pernah mengganggu UI.

### 4.6 nginx

Disediakan `deploy/nginx/kasir.conf` contoh:

```nginx
server {
  listen 80;
  server_name kasir.lokal;
  client_max_body_size 200m;          # upload restore DB
  location / {
    proxy_pass http://127.0.0.1:17720;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Server membaca `X-Forwarded-Proto` untuk memutuskan flag `Secure` pada cookie, dan `X-Forwarded-For` untuk rate limit, **hanya** bila `KASIR_TRUST_PROXY=1`.

## 5. Migrasi HeroUI v3

### 5.1 Fakta yang sudah diverifikasi

- `@heroui/react` **3.2.4**, `@heroui/styles` 3.2.4. Peer: React ≥19 (proyek ini React 19.2 ✓), Tailwind ≥4 (proyek ini 4.2 ✓), `react-aria-components` ^1.20.
- Setup hanya dua baris CSS, berurutan: `@import "tailwindcss";` lalu `@import "@heroui/styles";`. **Tidak ada Provider.** Tema lewat class `light`/`dark` + `data-theme` di `<html>`.
- Dokumentasi lengkap sudah diunduh ke `.heroui-docs/` (6,4 MB, sudah masuk `.gitignore`) dan diindeks di `AGENTS.md`. Semua pekerjaan komponen wajib merujuk file itu, bukan ingatan.

### 5.2 Pemetaan komponen

34 komponen shadcn dipakai di 300+ call-site. Yang tersedia langsung di HeroUI: Button, Input, Card, Badge, Table, Select, Label, Separator, Modal (dialog), Skeleton, Popover, Calendar/DateRangePicker, AlertDialog, TextArea, Tooltip, Tabs, Switch, Checkbox, Avatar, Alert, InputGroup, Kbd, Drawer, Toast, Pagination, ComboBox/Autocomplete, ScrollShadow.

Yang **tidak ada** di HeroUI v3 dan harus ditangani khusus:

| Sekarang | Rencana |
|---|---|
| `ui/sidebar.tsx` (715 baris, dipakai 5 file) | Ditulis ulang sebagai komponen aplikasi `components/layout/sidebar.tsx` memakai primitif HeroUI + Tailwind. Fitur yang dipertahankan: collapse ke ikon, auto-collapse < 1280px, Ctrl+B, state persist |
| `ui/command.tsx` (cmdk) | Dipakai 1 tempat → ganti `Autocomplete` HeroUI |
| `ui/combobox.tsx` (300 baris) | Ganti `ComboBox` HeroUI |
| `ui/chart.tsx` + recharts | **Tetap recharts**, hanya token warnanya dipetakan ke variabel tema HeroUI |
| `sonner` (toast, 20 file) | Ganti `Toast` HeroUI (`Toast.Provider` + `toast()`) |
| `vaul` Drawer | `Drawer` HeroUI |
| `react-day-picker` (11 halaman laporan) | `DateRangePicker` HeroUI |
| `ui/empty.tsx`, `field.tsx`, `input-group.tsx`, `status-badge.tsx` | Disesuaikan; `Field`/`InputGroup` ada padanannya di HeroUI |

Dependency yang dicabut setelah migrasi: seluruh `@radix-ui/*`, `radix-ui`, `@base-ui/react`, `cmdk`, `vaul`, `sonner`, `react-day-picker`, `shadcn`, `tw-animate-css`, `class-variance-authority`, `tailwind-merge` (HeroUI membawa sendiri). `@dnd-kit/*` dan `@tanstack/react-table` **sudah tidak dipakai sama sekali** — dihapus sekarang juga.

### 5.3 Urutan migrasi UI

Per-halaman, bukan per-komponen, supaya setiap commit menghasilkan layar yang benar-benar bisa dipakai. Urutan: shell (layout+sidebar+toast) → login/onboarding → kasir → produk → transaksi → refund → stok → shift → laporan → dashboard → pengaturan → PPOB.

### 5.4 Keputusan gelombang pertama (fondasi + login/onboarding)

| Keputusan | Isi |
|---|---|
| Ikon | **`lucide-react` tetap dipakai.** HeroUI v3 tidak membawa set ikon dan tidak mensyaratkan satu pun; ikon internalnya (chevron, check) sudah menyatu di komponen. Contoh di dokumentasi memakai `@gravity-ui/icons`, itu hanya pilihan penulis dokumen. Menambah set ikon kedua tidak memberi apa-apa selain ukuran bundle |
| `tw-animate-css` | Import di `src/index.css` dihapus, `@heroui/styles` sudah membawanya. Paketnya tetap terpasang sebagai dependency `@heroui/styles` |
| `shadcn/tailwind.css` | **Tetap.** Satu-satunya sumber custom variant `data-open`, `data-closed`, `data-checked`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal`, `data-vertical`, plus utility `no-scrollbar`, yang masih dipakai layar-layar yang belum dimigrasi |
| `@custom-variant dark` lokal | Dihapus. `@heroui/styles` mendefinisikan versi yang lebih luas (`.dark`, `[data-theme="dark"]`, elemen itu sendiri maupun turunannya) |
| Tabrakan token | shadcn dan HeroUI memberi arti berbeda pada `--muted`, `--accent`, dan `--accent-foreground`. Nama-nama itu diserahkan ke HeroUI; sisi shadcn dipindahkan ke kosakata HeroUI: `bg-muted` dan `bg-accent` → `bg-default`, `text-accent-foreground` → `text-default-foreground`. `--muted-foreground` tidak diutak-atik karena HeroUI tidak pernah membacanya |
| `--chart-1..5` | Tetap ada di `:root`/`.dark`; `components/ui/chart.tsx` (recharts) membacanya langsung dan recharts tidak diganti |
| Tema gelap | Lewat class `dark` + `data-theme="dark"` di `<html>`. `index.html` mengirim `class="light" data-theme="light"` sebagai bawaan. Belum ada tombol pengalih; kalau nanti dibutuhkan pakai `useTheme` dari `@heroui/react` (versi React biasa, bukan `next-themes`) |
| `sonner` | Dicabut. `src/lib/toast.ts` sekarang membungkus `toast` HeroUI (`error` → varian `danger`), `Toast.Provider` dipasang sekali di `App.tsx` dengan `placement="bottom end"` |
| `components/ui/field.tsx` | Dihapus. Padanannya di HeroUI adalah komposisi `TextField` + `Label` + `Description` + `FieldError`; hanya login dan onboarding yang memakainya |
| Validasi form | `Form` HeroUI memakai validasi native React Aria secara bawaan. Field dengan `isInvalid` memanggil `setCustomValidity`, sehingga browser menolak submit berikutnya — termasuk submit yang seharusnya menghapus error itu. Layar yang memvalidasi sendiri **wajib** memakai `validationBehavior="aria"` pada `Form` |
| `Description` HeroUI | Hanya merender kalau ada text slot `description` dari field induknya. Keterangan yang berdiri sendiri tetap memakai `<p>` biasa |

## 6. Rencana fase

| Fase | Isi | Gerbang lulus |
|---|---|---|
| **P0** | Perbaiki fixture test Rust yang tidak compile; perbaiki bug kritis dari hasil audit; hapus 41 file `tmp-*.png` dan dependency mati | `cargo test` hijau, `bun run test` hijau |
| **P1** | Ekstrak `domain/` + `services/` dari `commands/`; pindahkan test bisnis ke service; belum ada perubahan transport | `cargo test` hijau, aplikasi Tauri masih jalan |
| **P2** | axum + session + middleware + seluruh route + static embed; window Tauri diarahkan ke server lokal; `commands/` dihapus | app desktop jalan lewat HTTP, login pakai cookie |
| **P3** | Frontend: API client, `useApiQuery/Mutation`, browser router, auth via `/me`, export/import lewat HTTP | `tsc -b`, vitest, lint hijau; alur utama terverifikasi di browser |
| **P4** | Migrasi HeroUI per halaman; cabut dependency lama | tiap halaman diverifikasi tampil benar |
| **P5** | Clean code menyeluruh, Prettier ke seluruh repo, tambah test untuk perhitungan uang, perbarui `README.md`/`CLAUDE.md`/`CONTRIBUTING.md`, `deploy/nginx/`, dokumen deployment | semua gerbang hijau sekaligus |

Aturan eksekusi: **hanya satu proses build/test yang boleh jalan pada satu waktu.** Agent implementasi tidak menjalankan `cargo`/`bun` sendiri kecuali dijadwalkan; verifikasi dijalankan terpusat.

## 7. Risiko

| Risiko | Penanganan |
|---|---|
| Printer thermal hanya ada di PC kasir | Memang begitu desainnya: backend (dan printer) di PC kasir, klien LAN mencetak lewat server. Didokumentasikan |
| Beberapa terminal membuka shift bersamaan | Di luar cakupan sekarang. Dicatat sebagai batasan; shift tetap satu aktif per toko |
| Data toko terekspos di LAN | Session cookie + role guard + rate limit + origin check. Tanpa HTTPS di LAN, trafik masih plaintext — dicatat sebagai batasan yang diterima untuk jaringan toko |
| Migrasi UI menyentuh 300+ call-site | Dikerjakan per halaman dengan verifikasi visual, bukan cari-ganti massal |
| Refactor besar menyembunyikan regresi | Test bisnis dipindah ke `services/` lebih dulu (P1) supaya jaring pengaman ada sebelum transport diganti |

## 8. Yang sengaja tidak dikerjakan

- Enkripsi database SQLite.
- HTTPS/sertifikat, akses dari internet, multi-toko, sinkronisasi antar-cabang.
- Binary headless terpisah tanpa Tauri.
- i18n bahasa Inggris.
