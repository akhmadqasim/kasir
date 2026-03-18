# CLAUDE.md — POS Toko Sembako

## Project Overview

Aplikasi Point of Sale (POS) desktop untuk toko sembako. Single-terminal, local-first, offline-capable.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app/) (Rust backend + webview frontend) |
| Frontend | React 18 + TypeScript |
| UI Components | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS |
| State Management | Zustand |
| Database | SQLite via `rusqlite` (Rust-side) |
| ORM/Query | SQLite with raw SQL in Rust, exposed via Tauri commands |
| Receipt Printing | ESC/POS protocol via serial/USB |
| Barcode | EAN-13 (standard 2D retail Indonesia) |
| i18n | Indonesian (primary), English (secondary, later) |
| Package Manager | Bun |

## Architecture

```
src/                    # Frontend (React + TypeScript)
├── app/                # App entry, router, providers
├── components/         # Reusable UI components (shadcn-based)
│   ├── ui/             # shadcn/ui primitives
│   └── ...             # Domain components
├── features/           # Feature modules (co-located logic + UI)
│   ├── auth/           # Login, session, role management
│   ├── cashier/        # POS terminal / kasir screen
│   ├── products/       # Product CRUD, barcode, categories
│   ├── transactions/   # Transaction history, detail
│   ├── refunds/        # Refund & exchange flow
│   ├── stock/          # Stock management, write-off
│   ├── reports/        # Sales & loss reports
│   ├── receipt/        # Receipt preview & printing
│   ├── onboarding/     # First-time setup (store info)
│   └── settings/       # App settings
├── hooks/              # Shared React hooks
├── lib/                # Utilities, constants, types
├── i18n/               # Internationalization (id, en)
└── styles/             # Global styles, Tailwind config

src-tauri/              # Backend (Rust)
├── src/
│   ├── main.rs         # Tauri entry point
│   ├── db/             # Database setup, migrations, queries
│   │   ├── mod.rs
│   │   ├── migrations/ # SQL migration files
│   │   └── models/     # Rust structs matching DB tables
│   ├── commands/       # Tauri IPC commands (exposed to frontend)
│   │   ├── auth.rs
│   │   ├── products.rs
│   │   ├── transactions.rs
│   │   ├── refunds.rs
│   │   ├── stock.rs
│   │   ├── reports.rs
│   │   ├── receipt.rs
│   │   └── settings.rs
│   ├── printing/       # ESC/POS thermal printer driver
│   └── utils/          # Shared Rust utilities
├── migrations/         # SQL migration files
├── Cargo.toml
└── tauri.conf.json
```

## Database Schema (SQLite)

### Core Tables

```sql
-- Informasi toko (dari onboarding)
store_info (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_path TEXT,
  additional_info TEXT,          -- JSON for extra receipt fields
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Pengguna / karyawan
users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,         -- bcrypt hashed PIN
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'kasir')),
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Kategori produk
categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Produk (~10.000 items)
products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT UNIQUE,            -- EAN-13, nullable for non-barcoded items
  sku TEXT UNIQUE,                -- Internal SKU
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  buy_price REAL NOT NULL DEFAULT 0,   -- Harga modal
  sell_price REAL NOT NULL,            -- Harga jual
  stock INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',    -- pcs, kg, liter, dll
  min_stock INTEGER DEFAULT 0,         -- Alert threshold
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Transaksi penjualan
transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT NOT NULL UNIQUE,  -- Format: TRX-YYYYMMDD-XXXX
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'ewallet', 'transfer')),
  payment_amount REAL NOT NULL,        -- Jumlah yang dibayar
  change_amount REAL DEFAULT 0,        -- Kembalian
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'refunded', 'partial_refund')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Item dalam transaksi
transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,          -- Snapshot nama saat transaksi
  product_price REAL NOT NULL,         -- Snapshot harga saat transaksi
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Refund & exchange
refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_number TEXT NOT NULL UNIQUE,   -- Format: RFD-YYYYMMDD-XXXX
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('refund', 'exchange')),
  total_refund_amount REAL NOT NULL,    -- Total nilai barang yang diretur
  total_exchange_amount REAL DEFAULT 0, -- Total nilai barang pengganti (exchange)
  difference_amount REAL DEFAULT 0,     -- Selisih (+ pelanggan bayar, - toko kembalikan)
  payment_method TEXT CHECK(payment_method IN ('cash', 'qris', 'ewallet', 'transfer')),
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Item yang di-refund/exchange
refund_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id INTEGER NOT NULL REFERENCES refunds(id),
  transaction_item_id INTEGER NOT NULL REFERENCES transaction_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,            -- Qty yang dikembalikan
  subtotal REAL NOT NULL,
  condition TEXT CHECK(condition IN ('good', 'damaged', 'expired')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Item pengganti (untuk exchange)
exchange_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id INTEGER NOT NULL REFERENCES refunds(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

-- Stock write-off (barang rusak/kadaluarsa/hilang)
stock_writeoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  writeoff_number TEXT NOT NULL UNIQUE,  -- Format: WO-YYYYMMDD-XXXX
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('damaged', 'expired', 'lost', 'other')),
  loss_value REAL NOT NULL,              -- buy_price × quantity
  notes TEXT,
  approved_by INTEGER REFERENCES users(id),  -- NULL jika tidak perlu approval
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
  refund_id INTEGER REFERENCES refunds(id),  -- Link ke refund jika dari return
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### Indexes (Performance Critical)

```sql
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_transactions_date ON transactions(created_at);
CREATE INDEX idx_transactions_receipt ON transactions(receipt_number);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transaction_items_txn ON transaction_items(transaction_id);
CREATE INDEX idx_refunds_transaction ON refunds(transaction_id);
CREATE INDEX idx_refunds_date ON refunds(created_at);
CREATE INDEX idx_stock_writeoffs_product ON stock_writeoffs(product_id);
CREATE INDEX idx_stock_writeoffs_date ON stock_writeoffs(created_at);
```

## SQLite Configuration (Performance)

```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging for concurrent read/write
PRAGMA synchronous = NORMAL;        -- Balance between safety and speed
PRAGMA cache_size = -64000;         -- 64MB cache
PRAGMA foreign_keys = ON;           -- Enforce FK constraints
PRAGMA busy_timeout = 5000;         -- 5s timeout for locked DB
PRAGMA temp_store = MEMORY;         -- Temp tables in memory
```

## Business Rules

### Transaksi (Cashier)
- Scan barcode → produk ditambah ke keranjang
- Scan barcode yang sudah ada di keranjang → qty +1 (bukan baris baru)
- Qty bisa diedit manual di keranjang
- Input manual via search nama/barcode untuk barang tanpa scanner
- Metode pembayaran: cash, QRIS, e-wallet, transfer bank
- Cash: hitung kembalian otomatis
- Stok otomatis berkurang setelah transaksi selesai
- Receipt number auto-generate: TRX-YYYYMMDD-XXXX

### Refund
- Maksimal 7 hari setelah pembelian
- Bisa full refund (semua item) atau partial (beberapa item)
- Kalkulator pengembalian dana otomatis
- Stok otomatis bertambah kembali untuk barang kondisi baik
- Barang rusak/kadaluarsa → masuk stock write-off otomatis

### Exchange (Tukar Barang)
- Pelanggan return barang lama → pilih barang baru
- Kalkulator selisih harga otomatis
- Selisih positif → pelanggan bayar
- Selisih negatif → toko kembalikan uang
- Bisa tukar barang sama (administrasi, misal rusak ganti baru)
- Maksimal 7 hari setelah pembelian

### Stock Write-off
- **Rusak/Kadaluarsa**: kasir BISA langsung lakukan (bukti fisik ada di storage)
- **Hilang**: hanya admin yang bisa (tidak ada bukti fisik)
- Catat: qty, alasan, nilai kerugian (harga modal × qty)
- Bisa di-link ke refund jika berasal dari return pelanggan
- Masuk laporan kerugian

### Users & Roles
- **Admin**: full akses (semua fitur + manajemen user + write-off hilang)
- **Kasir**: transaksi, refund/exchange, write-off rusak/kadaluarsa, lihat laporan sendiri
- Login via username + PIN (4-6 digit)

### Onboarding (First-time Setup)
- Input: nama toko, alamat, no. telepon, email (opsional), logo (opsional)
- Buat akun admin pertama
- Data tersimpan di store_info, tampil di receipt

### Receipt (Struk Thermal)
- Header: nama toko, alamat, telepon, info tambahan
- Body: daftar item (nama, qty, harga, subtotal)
- Footer: total, metode pembayaran, kembalian, tanggal, kasir, receipt number
- Print via ESC/POS ke thermal printer

### Reports
- Penjualan harian & bulanan
- Per metode pembayaran
- Produk terlaris
- Stok menipis (di bawah min_stock)
- Laporan kerugian (write-off)
- Filter by tanggal

## Coding Conventions

### General
- Bahasa kode: **English** (variable names, functions, comments)
- Bahasa UI: **Indonesian** (labels, messages, placeholders)
- TypeScript strict mode
- No `any` type — gunakan proper typing
- Prefer `const` over `let`
- Destructure props dan objects
- Error handling: Result type di Rust, try-catch di TypeScript

### Frontend (React + TypeScript)
- Functional components only
- Feature-based folder structure (co-locate related files)
- shadcn/ui untuk semua base components
- Tailwind CSS untuk styling (no CSS modules, no styled-components)
- Zustand stores per-feature
- React Query / TanStack Query untuk async state dari Tauri commands
- File naming: `kebab-case.tsx` untuk components, `use-kebab-case.ts` untuk hooks
- Export: named exports (no default exports, kecuali pages)

### Backend (Rust)
- Tauri commands as the API layer
- All DB queries in `db/` module
- Use `serde` for serialization
- Proper error types with `thiserror`
- Return `Result<T, E>` from all commands

### Database
- Migration-based schema changes (numbered SQL files)
- Snapshot product name & price in transaction_items (denormalization for history accuracy)
- All monetary values as REAL (f64) — display formatting di frontend
- Timestamps in UTC, display in local timezone di frontend

## Performance Guidelines

- Target: search produk < 50ms, create transaksi < 100ms
- SQLite WAL mode enabled
- Index semua kolom yang sering di-query (barcode, name, dates)
- Pagination untuk riwayat transaksi (50 per page)
- Virtual list untuk keranjang belanja yang panjang (1-100 items)
- Lazy load data yang tidak langsung terlihat
- Debounce search input (300ms)

## Testing Strategy

- Frontend: Vitest + React Testing Library
- Backend: Rust built-in tests (`cargo test`)
- E2E: Playwright (optional, later)
- Focus testing on: business logic, calculations, edge cases

## Security

- PIN di-hash dengan bcrypt sebelum disimpan
- Session timeout setelah inactivity
- SQLite database di-encrypt (opsional, later)
- No sensitive data in frontend state beyond current session
