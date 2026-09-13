/** Which step a `failed` phase came from. Only a failed `check` is silent. */
export type UpdateStep = "check" | "download" | "install"

/**
 * `GET /api/updates`, tagged on `phase`. Mirrors `UpdatePhase` in
 * `src-tauri/src/updater/mod.rs`; the two must move together.
 */
export type UpdateStatus = { current_version: string } & (
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up_to_date" }
  | { phase: "available"; version: string; notes: string | null; published_at: string | null }
  | { phase: "downloading"; version: string; received: number; total: number | null }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "failed"; step: UpdateStep; message: string }
)

export type UpdatePhase = UpdateStatus["phase"]
