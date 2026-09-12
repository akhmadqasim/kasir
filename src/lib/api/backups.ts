import type { BackupInfo, BackupStatus } from "@/features/settings/types"
import { apiDelete, apiDownload, apiGet, apiPost, apiUpload } from "./client"

/**
 * Backups, and moving the database in and out of the till.
 *
 * The two interesting ones no longer take a path from the client, because there
 * is no file dialog left to produce one:
 *
 * * **Export** is a download. The server checkpoints the WAL and streams
 *   `kasir.db`; the browser puts it wherever downloads go. The old command
 *   copied the database to whatever path the webview asked for, which was a
 *   path traversal the moment the webview could be a tablet on the LAN.
 * * **Import** is a multipart upload. The filename the upload carries is
 *   ignored outright — the bytes are checked for a SQLite header and written to
 *   one staging path the server owns, to be installed at the next launch.
 */

export function listBackups(): Promise<BackupInfo[]> {
  return apiGet<BackupInfo[]>("/backups")
}

export function getBackupStatus(): Promise<BackupStatus> {
  return apiGet<BackupStatus>("/backups/status")
}

export function createBackup(): Promise<BackupInfo> {
  return apiPost<BackupInfo>("/backups")
}

export function deleteBackup(filename: string): Promise<void> {
  return apiDelete<void>(`/backups/${encodeURIComponent(filename)}`)
}

/** Stages the backup; it becomes the live database at the next launch. */
export function restoreBackup(filename: string): Promise<string> {
  return apiPost<string>(`/backups/${encodeURIComponent(filename)}/restore`)
}

/** Resolves to the filename the browser saved. */
export function exportDatabase(): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10)
  return apiDownload("/backups/export", `kasir-export-${stamp}.db`)
}

/** Resolves to the server's message about what happens at the next launch. */
export function importDatabase(file: File): Promise<string> {
  return apiUpload<string>("/backups/import", file)
}
