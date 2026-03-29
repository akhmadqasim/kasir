# Contributing

## Commit Convention

Gunakan format [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

- detail 1
- detail 2
```

### Types (hanya gunakan yang ini)
| Type | Kapan digunakan |
|------|----------------|
| `feat` | Fitur baru |
| `fix` | Perbaikan bug |
| `chore` | Maintenance, dependencies, config, cleanup |
| `refactor` | Refactoring tanpa ubah behavior |
| `docs` | Dokumentasi |
| `test` | Menambah/memperbaiki test |
| `style` | Formatting, styling (bukan CSS) |
| `perf` | Performance improvement |

> ⚠️ **JANGAN** gunakan type non-standar seperti `security`, `build`, `ci`, dll.
> Untuk security fix gunakan `fix`, untuk build/CI gunakan `chore`.

### Scopes

Scope **wajib** untuk `feat` dan `fix` agar mudah dicari di history.
Scope opsional untuk `chore`, `test`, `docs`, `refactor`, `style`, `perf`.

| Scope | Area |
|-------|------|
| `cashier` | POS terminal, cart, payment |
| `products` | Product CRUD, categories |
| `auth` | Login, session, roles |
| `transactions` | Transaction history |
| `refunds` | Refund & exchange |
| `stock` | Stock management, write-off |
| `reports` | Laporan penjualan & kerugian |
| `settings` | App settings |
| `printing` | Receipt printing, ESC/POS |
| `onboarding` | First-time setup |
| `dashboard` | Dashboard & analytics |
| `ppob` | PPOB integration |
| `ui` | Shared UI components, layout |
| `db` | Database migrations, schema |
| `shift` | Shift management |
| `backup` | Database backup |

### Rules
1. **JANGAN** tambahkan `Co-authored-by` dari AI (Claude, Copilot, Codex, dll) di commit message
2. Scope **wajib** untuk `feat` dan `fix` — contoh: `feat(cashier):`, `fix(auth):`
3. Description dalam **bahasa Inggris**, singkat dan jelas (max ~72 karakter)
4. Gunakan imperative mood — "add", "fix", "update" (bukan "added", "fixed", "updated")
5. Body opsional, gunakan format bullet list dengan `-`
6. Jangan akhiri subject line dengan titik (`.`)

### Contoh ✅

```
feat(cashier): add barcode scanning support

- integrate barcode scanner input handling
- auto-add product to cart on scan
- increment quantity if product already in cart
```

```
fix(auth): prevent session timeout on active tab
```

```
test: add backend tests for auth guard and products
```

```
chore: disable auto-logout for single-terminal POS
```

### Contoh ❌

```
security: add auth guards          ← type "security" tidak valid
feat: add barcode scanning         ← feat/fix harus pakai scope
fix(auth): Fixed login bug.        ← jangan past tense, jangan titik
Added new feature for products     ← tidak ada type prefix
```
