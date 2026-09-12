# @kasir/shared

Platform-neutral code shared by the kasir desktop (Tauri webview) and the mobile
companion app (Expo). Nothing in here touches the DOM, React Native, or Tauri.

```
src/
├── api/          createApiClient (injectable base URL + fetch), typed endpoint
│                 factories for auth / products / categories / stock, the LAN
│                 health probe, React Query key table
├── types/        Response and input shapes, one file per resource
├── stock/rules   Role gates and stock-count arithmetic (pure, tested)
├── net/lan       /24 subnet scan, server-origin normalisation (pure, tested)
├── format.ts     Rupiah, Indonesian number parsing, backend timestamps
├── labels.ts     Backend vocabulary → Indonesian labels
└── i18n/id.ts    UI copy
```

## Where this came from

Everything here was **copied**, not moved, from the desktop's `src/lib/` and
`src/features/*/types.ts`. The desktop still imports its own
copies.

**TODO (next step, separate PR):** point `src/lib/api/*`,
`src/lib/format.ts`, `src/lib/labels.ts` and the feature `types.ts` files at
`@kasir/shared`, delete the duplicates, and move the desktop app itself to
`apps/desktop`. Until then the two copies must be kept in step by hand.

## The client

```ts
import { createApiClient, createProductsApi } from "@kasir/shared"

const client = createApiClient({
  baseUrl: () => "http://192.168.1.10:17720/api", // re-read on every call
  headers: () => ({ Origin: "http://192.168.1.10:17720" }), // native only, see below
  onUnauthorized: () => session.clear(),
})
const products = createProductsApi(client)
await products.search({ query: "beras", per_page: 50 })
```

- `baseUrl` and `headers` are functions so the mobile app can switch servers at
  runtime without rebuilding the client.
- `fetch` is injectable; tests pass a fake, platforms pass nothing and get
  `globalThis.fetch`.
- Errors are always `ApiError { code, message, status, retryAfterSeconds }`.
  `message` is Indonesian and written for the screen; `code` is what code
  branches on. `"network"` (status 0) means the request never got an answer.
- A `401` calls `onUnauthorized` once, except for `login` and `getCurrentUser`
  which opt out.

### The `Origin` header (why the mobile client sets it)

The server refuses any `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` (or
`Referer`) authority is not its own `host[:port]`, and also refuses a write
that carries neither header (`src-tauri/src/http/middleware.rs`,
`check_origin`). In a browser that is satisfied automatically: the page is
same-origin with the API and the browser attaches `Origin` itself — script is
not even allowed to set it. React Native has no page, so a native `fetch`
sends **no** `Origin` and every write would fail with `code: "csrf"`.

Native `fetch` _is_ allowed to set `Origin`, so the mobile client passes it
through `headers()` as the server's own authority, `http://<host>:<port>`. That
is the one value the check accepts without `KASIR_ALLOWED_ORIGINS`.

### Health probe

There is no `/api/health` on the server yet. `probeServer()` uses the public
`GET /api/onboarding/status` (a bare JSON boolean) as the liveness check and
only accepts a body of exactly `true`/`false`, so a router admin page that
answers 200 to everything is not mistaken for a kasir server.

## Scripts

```
bun run --cwd packages/shared typecheck   # tsc --noEmit
bun run --cwd packages/shared test        # vitest
```
