# POS Toko Sembako

Aplikasi Point of Sale (POS) desktop untuk toko sembako. Single-terminal, local-first, offline-capable.

## Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/) (Rust backend + webview frontend)
- **Frontend**: React 19 + TypeScript (strict mode)
- **UI**: [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4
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

# Start development (frontend + Tauri)
bun run tauri dev

# Run frontend only
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
├── components/ui/      # shadcn/ui components
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
└── i18n/               # Translations

src-tauri/              # Backend (Rust)
├── src/
│   ├── commands/       # Tauri IPC commands
│   ├── db/             # Database, migrations, models
│   ├── printing/       # ESC/POS thermal printer
│   └── utils/          # Error handling, helpers
└── migrations/         # SQL migration files
```

## License

Private — All rights reserved.

