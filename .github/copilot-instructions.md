# Copilot Instructions — POS Toko Sembako

## Project Context

This is a **Point of Sale (POS)** desktop application for a grocery store (toko sembako) in Indonesia. Built with **Tauri v2 + axum + React + TypeScript + HeroUI + SQLite**.

Key characteristics:
- Single terminal, local-first, offline-capable
- Heavy transaction volume: 100-1000 customers/day, 1-100 items/transaction
- ~10,000 product SKUs with barcode scanning
- Thermal receipt printing (ESC/POS)

## Tech Stack

- **Desktop framework**: Tauri v2 — the Rust backend runs an embedded axum HTTP API under `/api`; the window loads `http://127.0.0.1:<port>`. No Tauri IPC commands.
- **Frontend**: React 19 + TypeScript (strict mode)
- **UI**: HeroUI v3 + Tailwind CSS v4 (only `src/components/ui/chart.tsx` remains from shadcn/ui, as a recharts wrapper)
- **State**: Zustand (per-feature stores) + TanStack Query
- **Database**: SQLite via `sea-orm` (`sqlx-sqlite` backend); `rusqlite` for the backup reader only
- **i18n**: Indonesian (primary), English (later)
- **Package manager**: Bun

## Code Style

### TypeScript / React
- Functional components only, no class components
- Named exports (no default exports except pages)
- File naming: `kebab-case.tsx` for components, `use-kebab-case.ts` for hooks
- No `any` — use proper types
- Prefer `const` over `let`
- Destructure props and state
- Use HeroUI v3 components as base — do not create custom primitives
- Tailwind CSS for all styling
- Talk to the backend through `src/lib/api/` (`fetch`-based client) — there is no Tauri `invoke`

### Rust
- axum HTTP routes under `src-tauri/src/http/routes/` as the API layer — no Tauri commands
- Identity comes from the server-side session cookie (`http::session`), never from the request body
- DB queries live in `src-tauri/src/services/`, built on `sea-orm` entities (`src-tauri/src/entity/`)
- Use `serde::{Serialize, Deserialize}` for all response types
- Error handling with `thiserror` crate
- Return `Result<T, AppError>` from all services/handlers

### Naming
- Code identifiers: **English** (variables, functions, types, database columns)
- UI text: **Indonesian** (labels, messages, placeholders, toasts)
- Example: `sell_price` in code, "Harga Jual" in UI

## Database Patterns

- SQLite with WAL mode for performance
- Migration-based schema changes (numbered SQL files)
- Denormalize product name & price into transaction_items (historical accuracy)
- Monetary values: REAL (f64), formatted in frontend
- Timestamps: UTC in DB, local timezone in UI
- Always use parameterized queries (prevent SQL injection)

## Key Business Logic

### Cashier / Transaction
- Barcode scan → add to cart (or qty+1 if already in cart)
- Manual quantity editing in cart
- Payment methods: cash, QRIS, e-wallet, bank transfer (recording only, no integration)
- Auto-calculate change for cash payments
- Auto-reduce stock on transaction completion

### Refund & Exchange
- Max 7 days after purchase
- Full or partial refund supported
- Exchange: return old items → pick new items → calculate price difference
- Auto-restore stock for items in good condition
- Damaged/expired returned items → auto stock write-off

### Stock Write-off
- Damaged/expired: kasir can perform directly (physical evidence in storage)
- Lost items: admin approval required (no physical evidence)
- Track: quantity, reason, loss value (buy_price × qty)

### User Roles
- **Admin**: full access, all features, manage users, approve lost item write-offs
- **Kasir**: transactions, refunds/exchanges, damaged/expired write-offs, view own reports

## Performance Requirements

- Product search: < 50ms response
- Transaction creation: < 100ms
- Use indexed queries for barcode and product name lookups
- Paginate transaction history (50 per page)
- Virtual scrolling for long cart lists (up to 100 items)
- Debounce search inputs (300ms)

## Do NOT

- Do not use CSS modules or styled-components (use Tailwind only)
- Do not use default exports (except page components)
- Do not use `any` type in TypeScript
- Do not store raw PINs (always hash with bcrypt)
- Do not put SQL queries in frontend code (all DB access goes through the HTTP API)
- Do not hardcode store information (comes from onboarding/settings)
- Do not use Indonesian for code identifiers (only for UI strings)
