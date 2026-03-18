---
name: db-migrate
description: Create or run database migrations
user_invocable: true
---

Database migration helper:

1. If argument is "new <name>": create a new migration file in `src-tauri/migrations/` with the next sequence number
2. If argument is "run": run pending migrations via the app's migration system
3. If no argument: list all migration files and their status
4. Always show the current schema version
