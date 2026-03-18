---
name: test
description: Run all tests (frontend + backend)
user_invocable: true
---

Run all project tests:

1. Run frontend tests: `bun run test`
2. Run backend tests: `cd src-tauri && cargo test`
3. Report results summary — number of passed, failed, skipped
4. If any tests fail, analyze the failure and suggest fixes
