# POS Toko Sembako

Aplikasi Point of Sale (POS) desktop untuk toko sembako. Single-terminal, local-first, offline-capable.

## Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/) (Rust backend + webview frontend)
- **Frontend**: React 19 + TypeScript (strict mode)
- **UI**: [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS v4
- **State**: Zustand + TanStack Query
- **Database**: SQLite via rusqlite (Rust-side, WAL mode)
- **Package Manager**: Bun

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Bun](https://bun.sh/) v1.3+
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

