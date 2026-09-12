# @kasir/mobile — Kasir Stok

Companion app (iOS + Android) for the kasir desktop POS. It is a **stock tool**,
not a sales monitor: scan a barcode, see the product, count what is on the
shelf, write off what is damaged, fix a price. It talks to the desktop's
embedded HTTP API over the shop Wi-Fi and stores nothing of its own.

Stack: Expo SDK 57 (managed, Expo Router) · React Native 0.86 · HeroUI Native
1.0.9 via Uniwind/Tailwind v4 · TanStack Query · Zustand · `@kasir/shared`.

## Run

```sh
bun install --linker=hoisted        # at the repo root, once (see "Workspace" below)
cd apps/mobile
bunx expo start                     # Metro; scan the QR with Expo Go
```

Everything the app uses (`expo-camera`, `expo-network`, `expo-secure-store`)
is included in Expo Go, so no dev client is needed to try it. For a build that
goes on a phone permanently:

```sh
bunx expo run:android      # or: eas build --profile development
bunx expo run:ios
```

Checks that must pass before a commit:

```sh
bunx tsc --noEmit          # strict, with typed routes once `expo start` has generated .expo/types
bunx eslint .
bunx prettier --check .
bun run --cwd ../../packages/shared test
```

## How the phone finds the desktop

The desktop binds its axum server to `KASIR_BIND` (default `0.0.0.0`, i.e.
reachable from the LAN) on `KASIR_PORT` (default **17720**). If that port is
taken it walks up to 17729 and only the startup log says which one it got —
the desktop UI does not show it yet (see backend checklist).

The first screen offers two ways in, both ending in "Uji koneksi" and the same
saved `http://host:port`:

1. **Cari otomatis** — reads the phone's IPv4 via `expo-network`, assumes a /24
   (the API gives no subnet mask), and probes every host on the chosen port
   with `GET /api/onboarding/status`, 32 in flight, 600 ms timeout each. Every
   responder whose body is exactly `true`/`false` is listed; tap to select.
   No native module, so it works in Expo Go. mDNS is the better long-term path
   (checklist).
2. **Alamat server** — type `192.168.1.10`, `192.168.1.10:17721` or a hostname.

The chosen origin is persisted in `expo-secure-store`. Nothing else is: the
session is an `HttpOnly` cookie in the platform cookie jar, and the PIN never
leaves the login request.

### Cleartext HTTP

The desktop speaks plain HTTP on the LAN. `app.json` therefore sets
`expo-build-properties → android.usesCleartextTraffic: true` and
`ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking: true`, plus
`NSLocalNetworkUsageDescription` so iOS 14+ shows the local-network prompt.

### The `Origin` header

The server refuses any `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` (or
`Referer`) authority is not its own `host:port`, and refuses a write with
neither header (`src-tauri/src/http/middleware.rs`). A browser attaches
`Origin` itself; React Native's `fetch` does not — but, unlike a browser, lets
us set it. `src/lib/api.ts` therefore sends `Origin: http://<host>:<port>`
(the server's own authority) on every request. Without it every write fails
with `code: "csrf"`.

## Screens and roles

| Tab / screen         | Kasir                                                      | Admin                                                    |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Scan                 | camera + manual barcode/SKU → detail                       | same, plus "Tambah produk" on an unknown barcode         |
| Produk               | search (300 ms debounce, 50/page) → detail                 | same                                                     |
| Stok Menipis         | `quick_filter=low_stock` → detail                          | same                                                     |
| Detail produk        | no buying price; Hitung Stok, Write-off                    | + buying price, Ubah harga & minimal stok                |
| Hitung Stok (opname) | shortfall → write-off `damaged`/`expired`; surplus blocked | count becomes stock; shortfall with a reason → write-off |
| Write-off            | `damaged`, `expired`                                       | + `lost`, `other`                                        |
| Pengaturan           | server, account, Keluar                                    | same                                                     |

Role gating in the UI is a courtesy so no button leads to a refusal. **The
server is the authority**: it reads the role from the session cookie and
enforces the same rules in `services/products.rs` and `services/stock.rs`
regardless of what the client sends.

## Workspace

The repo root is a Bun workspace (`apps/*`, `packages/*`). Notes:

- **`--linker=hoisted`.** Bun's default isolated linker failed to link several
  React Native packages on Windows (`ENOENT … (copyfile)` from over-long paths
  under `node_modules/.bun/`). Hoisted installs work and are also what the Expo
  monorepo guide recommends.
- **One React.** The desktop pins `react ^19.2.4`; this app declares the same
  range so Bun dedupes to a single copy at the root. `expo-doctor` would
  prefer the exact `19.2.3` RN 0.86 was released with, so `react`/`react-dom`
  are in `expo.install.exclude`. Two React copies would break every hook.
- **Metro** needs no monorepo overrides on SDK 52+; `metro.config.js` only adds
  Uniwind. `@kasir/shared` is consumed as TypeScript source through the
  workspace symlink.
- **The desktop stays at the repo root for now.** Moving it to `apps/desktop`
  happens after the web/HeroUI branch merges, together with pointing the
  desktop's `src/lib/*` at `@kasir/shared`.
- **This branch is based on `master`, which still speaks Tauri IPC.** The HTTP
  API this app calls exists only on the `worktree-web-heroui` branch
  (`src-tauri/src/http/`). The shared package was copied from that branch's
  `src/lib/api/`. Until that branch merges, run the desktop from it to test.

## Not done

- Cashier checkout, refunds, receipts/printing, reports, PPOB.
- Offline mode: every screen needs the desktop reachable.
- Stock-adjustment audit trail: an admin's count is a whole-row
  `PUT /products/{id}` (no history). A kasir cannot adjust at all.
- Deep links straight to `/products/:id` show "Barang tidak ditemukan" — the
  detail screen is fed from the list/scanner cache because the server has no
  `GET /products/{id}`.
- Push notifications, Liquid Glass / `NativeTabs` (see research note in the
  final report), tablet layout.

## Backend checklist (not changed here)

1. `GET /api/health` → `{ ok: true, app: "kasir", version, store_name }`,
   public. Discovery currently piggybacks on `/api/onboarding/status`.
2. `GET /api/products/{id}` — detail by id, so deep links and refetches stop
   going through barcode/name search.
3. `POST /api/stock/adjustments { productId, countedStock, notes }` — records
   who counted what and the delta; allowed for kasir (server decides whether a
   shortfall auto-creates a write-off) and admin. Removes the need for the
   whole-row `PUT` on a count.
4. Show the bound HTTP port (and LAN IP) in the desktop's Pengaturan so a user
   can type it into the phone; log line is the only place it appears now.
5. mDNS/Bonjour: advertise `_kasir._tcp` from Rust (`mdns-sd`) and listen with
   `react-native-zeroconf` in a dev client — replaces the /24 sweep.
6. CSRF: no change required (native sets `Origin`), but consider accepting a
   documented `X-Requested-With: kasir-mobile` as an alternative for clients
   that cannot set `Origin`.
7. Cookie: `SameSite=Lax; HttpOnly; Path=/` works for native. `Secure` stays
   off on plain HTTP. Consider a longer `max_age` for phones (sliding expiry is
   already implemented).
8. Rate limiting keys on `X-Forwarded-For` only with `KASIR_TRUST_PROXY`; a
   phone hits the port directly, so its socket address is used — fine.
