# Contributing

## Commit Convention

Gunakan format [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

- detail 1
- detail 2
```

### Types
- `feat` — fitur baru
- `fix` — perbaikan bug
- `chore` — maintenance, dependencies, config
- `refactor` — refactoring tanpa ubah behavior
- `docs` — dokumentasi
- `test` — menambah/memperbaiki test
- `style` — formatting, styling (bukan CSS)
- `perf` — performance improvement

### Rules
- **JANGAN** tambahkan `Co-authored-by` dari AI (Claude, Copilot, Codex, dll) di commit message
- Scope opsional, tapi direkomendasikan (contoh: `feat(cashier)`, `fix(auth)`)
- Description dalam bahasa Inggris, singkat dan jelas
- Body menggunakan format bullet list dengan `-`

### Contoh

```
feat(cashier): add barcode scanning support

- integrate barcode scanner input handling
- auto-add product to cart on scan
- increment quantity if product already in cart
```
