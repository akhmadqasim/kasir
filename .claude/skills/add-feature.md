---
name: add-feature
description: Scaffold a new feature module with standard structure
user_invocable: true
---

Scaffold a new feature module. Argument should be the feature name (e.g., "discounts").

Create the following structure in `src/features/<feature-name>/`:

```
<feature-name>/
├── index.ts              # Public exports
├── components/           # Feature-specific components
│   └── .gitkeep
├── hooks/                # Feature-specific hooks
│   └── .gitkeep
├── store.ts              # Zustand store (if needed)
├── types.ts              # TypeScript types
└── utils.ts              # Feature utilities
```

Also create Rust command file at `src-tauri/src/commands/<feature_name>.rs` if the feature needs backend logic.

After scaffolding, remind the user to:
1. Add routes if the feature has pages
2. Add Tauri commands to the command registry
3. Create DB migration if new tables are needed
