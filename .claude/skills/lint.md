---
name: lint
description: Run linting and formatting checks
user_invocable: true
---

Run all code quality checks:

1. Run `bun run lint` for frontend linting (ESLint)
2. Run `bun run format --check` for formatting (Prettier)
3. Run `cd src-tauri && cargo clippy` for Rust linting
4. Run `cd src-tauri && cargo fmt --check` for Rust formatting
5. Report all issues found
6. Ask user if they want auto-fix applied
