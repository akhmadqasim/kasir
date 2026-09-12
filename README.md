# POS Toko Sembako

Aplikasi Point of Sale (POS) desktop untuk toko sembako. Single-terminal, local-first, offline-capable.

## Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/) — the Rust backend runs an embedded axum HTTP API under `/api`; the window just loads `http://127.0.0.1:<port>`. There are no Tauri IPC commands.
- **Frontend**: React 19 + TypeScript (strict mode)
- **UI**: [HeroUI v3](https://www.heroui.com/) + Tailwind CSS v4 (only `src/components/ui/chart.tsx` survives from shadcn/ui, as a recharts wrapper)
- **State**: Zustand + TanStack Query
- **Database**: SQLite via [sea-orm](https://www.sea-ql.org/SeaORM/) / sqlx-sqlite (WAL mode); `rusqlite` for the backup reader
- **Package Manager**: Bun

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Bun](https://bun.sh/) v1.4+
- [Rust](https://rustup.rs/) v1.70+
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows, "Desktop development with C++")

## Getting Started

```bash
# Install dependencies
bun install

# Start development (frontend + Tauri). KASIR_ALLOWED_ORIGINS lets the Vite
# dev server's origin (localhost:5173) pass the server's CSRF check — see
# deploy/README.md.
KASIR_ALLOWED_ORIGINS=http://localhost:5173 bun run tauri dev

# Run frontend only (talks to a server already running on 127.0.0.1:17720)
bun run dev

# Run tests
bun run test

# Build for production
bun run tauri build
```

## Release (local build & publish)

Releases are built **locally** and published to GitHub Releases — there is **no CI/CD**
(the repo is private, so Windows CI minutes are costly; local build is free). This
additionally requires the [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
with `repo` scope.

```powershell
# Bump version (package.json + tauri.conf.json + Cargo.toml), build, tag, push,
# and create a GitHub Release with the MSI + NSIS installers attached:
pwsh scripts/release.ps1 -Version 0.6.0

# Build only, do not publish:
pwsh scripts/release.ps1 -Version 0.6.0 -NoPublish
```

Nothing is committed, tagged, pushed, or published if the build fails. Installers
land in `src-tauri/target/release/bundle/{msi,nsis}/` and are currently
**unsigned** (Windows SmartScreen shows an "unknown publisher" warning — click
*More info → Run anyway*).

> **Build note:** on machines with many CPU cores but limited free RAM, release
> builds can OOM `rustc`. The script defaults to `-Jobs 2` (`CARGO_BUILD_JOBS=2`);
> raise it on a beefier machine for speed.

## Project Structure

```
src/                    # Frontend (React + TypeScript)
├── app/                # App entry, router, providers
├── components/ui/      # chart.tsx — the one non-HeroUI wrapper (recharts needs it)
├── features/           # Feature modules
│   ├── auth/           # Login, session
│   ├── cashier/        # POS terminal
│   ├── products/       # Product CRUD
│   ├── transactions/   # Transaction history
│   ├── refunds/        # Refund & exchange
│   ├── stock/          # Stock write-off
│   ├── reports/        # Sales reports
│   ├── receipt/        # Receipt printing
│   ├── onboarding/     # First-time setup
│   └── settings/       # App settings
├── hooks/              # Shared hooks
├── lib/                # Utilities, constants, types
│   └── api/            # fetch client + one typed module per resource
└── i18n/               # Translations

src-tauri/              # Backend (Rust)
├── src/
│   ├── domain/         # Core types (Actor, business entities)
│   ├── entity/         # sea-orm entities
│   ├── services/       # Business logic + DB queries — no tauri or axum here
│   ├── http/           # axum router, routes/, session, CSRF, idempotency
│   ├── db/             # DB setup + migration runner
│   ├── printing/       # ESC/POS thermal printer
│   └── utils/          # Error handling, helpers
└── migrations/         # SQL migration files
```

## License

Private — All rights reserved.

