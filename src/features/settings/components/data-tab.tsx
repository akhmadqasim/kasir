import React, { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  Upload,
  HardDrive,
  Shield,
  RefreshCw,
  Trash2,
  RotateCcw,
  Clock,
  FolderOpen,
  Settings2,
  ShieldCheck,
  ArrowDownToLine,
} from "lucide-react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { id } from "@/i18n/id"
import { formatDateTime } from "@/lib/format"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { BACKUP_LIST_QUERY_KEY, BACKUP_STATUS_QUERY_KEY, useCreateBackupMutation } from "../hooks/use-backup"
import type { AppSettings, BackupInfo, BackupStatus, DatabaseInfo } from "../types"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileDialogOptions {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

type FileDialogResult =
  | { outcome: "selected"; path: string }
  | { outcome: "cancelled" }
  | { outcome: "failed"; message: string }
  | { outcome: "unavailable" }

/**
 * Open the Tauri file dialog, keeping apart the three outcomes a single `try` used to
 * conflate: the plugin is missing, the dialog itself failed, and the user cancelled.
 * Only `"unavailable"` may fall back to a manually typed path — otherwise a failed
 * dialog would silently hand the operation a file the user never chose.
 */
async function chooseFilePath(
  mode: "open" | "save",
  options: FileDialogOptions
): Promise<FileDialogResult> {
  const dialog = await import("@tauri-apps/plugin-dialog").catch(() => null)
  if (!dialog) return { outcome: "unavailable" }

  try {
    const selected =
      mode === "save" ? await dialog.save(options) : await dialog.open(options)
    if (typeof selected !== "string" || !selected) return { outcome: "cancelled" }
    return { outcome: "selected", path: selected }
  } catch (error) {
    return { outcome: "failed", message: String(error) }
  }
}

const INTERVAL_OPTIONS = [
  { value: "1", label: "1 jam" },
  { value: "2", label: "2 jam" },
  { value: "3", label: "3 jam" },
  { value: "6", label: "6 jam" },
  { value: "12", label: "12 jam" },
  { value: "24", label: "24 jam" },
]

const RETENTION_OPTIONS = [
  { value: "30", label: "30 hari" },
  { value: "60", label: "60 hari" },
  { value: "90", label: "90 hari" },
  { value: "180", label: "180 hari" },
  { value: "365", label: "365 hari" },
]

function BackupSettingsInline({
  intervalHours,
  retentionDays,
}: {
  intervalHours: number
  retentionDays: number
}) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const settingsQuery = useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: () => invoke<AppSettings>("get_app_settings"),
  })

  const updateMutation = useMutation({
    mutationFn: (settings: AppSettings) =>
      invoke("update_app_settings", { settings, callerId: user!.id }),
    onSuccess: () => {
      toast.success("Pengaturan backup berhasil disimpan. Perubahan berlaku setelah restart.")
      queryClient.invalidateQueries({ queryKey: ["app-settings"] })
      queryClient.invalidateQueries({ queryKey: ["backup-status"] })
    },
    onError: (error) => toast.error(String(error)),
  })

  const handleChange = (field: "interval_hours" | "retention_days", value: string) => {
    const current = settingsQuery.data
    if (!current) return
    const updated = {
      ...current,
      backup: {
        ...current.backup,
        [field]: Number(value),
      },
    }
    updateMutation.mutate(updated)
  }

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/50 p-3">
      <Settings2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex items-center gap-2">
        <Label className="text-sm whitespace-nowrap">Interval:</Label>
        <Select
          value={String(intervalHours)}
          onValueChange={(v) => handleChange("interval_hours", v)}
          disabled={updateMutation.isPending || !settingsQuery.data}
        >
          <SelectTrigger className="w-[100px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-sm whitespace-nowrap">Retensi:</Label>
        <Select
          value={String(retentionDays)}
          onValueChange={(v) => handleChange("retention_days", v)}
          disabled={updateMutation.isPending || !settingsQuery.data}
        >
          <SelectTrigger className="w-[110px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function DataTab() {
  const [exportPath, setExportPath] = useState("")
  const [importPath, setImportPath] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const exportSectionRef = React.useRef<HTMLDivElement | null>(null)

  const dbInfoQuery = useQuery<DatabaseInfo>({
    queryKey: ["database-info"],
    queryFn: () => invoke<DatabaseInfo>("get_database_info"),
  })

  const backupStatusQuery = useQuery<BackupStatus>({
    queryKey: BACKUP_STATUS_QUERY_KEY,
    queryFn: () => invoke<BackupStatus>("get_backup_status"),
  })

  const backupListQuery = useQuery<BackupInfo[]>({
    queryKey: BACKUP_LIST_QUERY_KEY,
    queryFn: () => invoke<BackupInfo[]>("list_backups"),
  })
  const createBackupMutation = useCreateBackupMutation()

  const deleteBackupMutation = useMutation({
    mutationFn: (filename: string) => invoke("delete_backup", { filename, callerId: user!.id }),
    onSuccess: () => {
      toast.success("Backup berhasil dihapus")
      queryClient.invalidateQueries({ queryKey: ["backup-status"] })
      queryClient.invalidateQueries({ queryKey: ["backup-list"] })
    },
    onError: (error) => toast.error(String(error)),
  })

  const restoreBackupMutation = useMutation({
    mutationFn: (filename: string) => invoke<string>("restore_backup", { filename, callerId: user!.id }),
    onSuccess: (message) => toast.success(message),
    onError: (error) => toast.error(String(error)),
  })

  const handleExportWithDialog = async () => {
    setIsExporting(true)
    try {
      const chosen = await chooseFilePath("save", {
        defaultPath: "kasir-backup.db",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      })

      if (chosen.outcome === "cancelled") return
      if (chosen.outcome === "failed") {
        toast.error(`Gagal membuka dialog file: ${chosen.message}`)
        return
      }

      // The manual textbox is a fallback for builds without the dialog plugin only.
      // It must never stand in for a dialog the user actually used.
      const targetPath =
        chosen.outcome === "selected" ? chosen.path : exportPath.trim()
      if (!targetPath) {
        toast.error("Masukkan lokasi file export")
        return
      }

      try {
        await invoke<number>("export_database", {
          exportPath: targetPath,
          callerId: user!.id,
        })
        toast.success(id.settings.exportSuccess)
      } catch (error) {
        toast.error(String(error))
      }
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportWithDialog = async () => {
    setIsImporting(true)
    try {
      const chosen = await chooseFilePath("open", {
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      })

      if (chosen.outcome === "cancelled") return
      if (chosen.outcome === "failed") {
        toast.error(`Gagal membuka dialog file: ${chosen.message}`)
        return
      }

      // Importing overwrites the production database, so the textbox fallback is
      // reachable only when the dialog plugin itself is missing.
      const sourcePath =
        chosen.outcome === "selected" ? chosen.path : importPath.trim()
      if (!sourcePath) {
        toast.error("Masukkan lokasi file backup")
        return
      }

      try {
        await invoke<string>("import_database", {
          importPath: sourcePath,
          callerId: user!.id,
        })
        toast.success(id.settings.importSuccess)
      } catch (error) {
        toast.error(String(error))
      }
    } finally {
      setIsImporting(false)
    }
  }

  const status = backupStatusQuery.data
  const backups = backupListQuery.data ?? []
  const showSafetyBanner = !!dbInfoQuery.data && !!backupStatusQuery.data

  return (
    <div className="space-y-4">
      {showSafetyBanner && (
        <Alert className="border-primary/20 bg-primary/5 px-4 py-4 text-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <AlertTitle className="text-base">
            Update normal tidak menghapus data kasir.
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Database disimpan terpisah dari file aplikasi dan backup otomatis tetap berjalan.
              Jika pindah dari versi debug/portable ke installer, gunakan Export Database lalu Import Database.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => createBackupMutation.mutate()}
                disabled={createBackupMutation.isPending}
              >
                <Shield className="mr-2 h-4 w-4" />
                {createBackupMutation.isPending ? "Membuat backup..." : "Backup Sekarang"}
              </Button>
              <Button
                variant="outline"
                onClick={() => exportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" />
                Ke Export Database
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Database Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Database
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{id.settings.databaseSize}</span>
            <span className="font-medium">
              {dbInfoQuery.data ? formatFileSize(dbInfoQuery.data.size_bytes) : "—"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{id.settings.databasePath}</span>
            <span className="font-mono text-xs max-w-[300px] truncate">
              {dbInfoQuery.data?.path ?? "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Auto Backup Status & Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Backup Otomatis
          </CardTitle>
          <CardDescription>
            Backup otomatis setiap {status?.settings.interval_hours ?? 3} jam.
            Tersimpan selama {status?.settings.retention_days ?? 90} hari, file terkompresi (gzip).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Settings */}
          <BackupSettingsInline
            intervalHours={status?.settings.interval_hours ?? 3}
            retentionDays={status?.settings.retention_days ?? 90}
          />

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{status?.total_backups ?? 0}</div>
              <div className="text-xs text-muted-foreground">Total Backup</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">
                {status ? formatFileSize(status.total_size_bytes) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Total Ukuran</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{status?.settings.retention_days ?? 90}</div>
              <div className="text-xs text-muted-foreground">Hari Retensi</div>
            </div>
          </div>

          {status?.last_backup && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Backup terakhir: {formatDateTime(status.last_backup.created_at)} —{" "}
              {formatFileSize(status.last_backup.size_bytes)}
            </div>
          )}

          {status?.backup_dir && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              <span className="font-mono text-xs truncate">{status.backup_dir}</span>
            </div>
          )}

          <Button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
            variant="outline"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${createBackupMutation.isPending ? "animate-spin" : ""}`} />
            {createBackupMutation.isPending ? "Membuat backup..." : "Backup Sekarang"}
          </Button>
        </CardContent>
      </Card>

      {/* Backup List */}
      {backups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daftar Backup</CardTitle>
            <CardDescription>
              {backups.length} backup tersedia. Backup lama otomatis dihapus setelah {status?.settings.retention_days ?? 90} hari.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Ukuran</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup, i) => (
                    <TableRow key={backup.filename}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{backup.filename}</span>
                          {i === 0 && (
                            <Badge variant="secondary" className="text-xs">Terbaru</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatFileSize(backup.size_bytes)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Pulihkan Backup</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Database akan diganti dengan backup <strong>{backup.filename}</strong>.
                                  Data saat ini akan hilang. Pastikan sudah membuat backup terbaru.
                                  Aplikasi perlu di-restart setelah pemulihan.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => restoreBackupMutation.mutate(backup.filename)}
                                >
                                  Ya, Pulihkan
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Hapus Backup</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Hapus backup <strong>{backup.filename}</strong>? Tindakan ini tidak dapat dibatalkan.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteBackupMutation.mutate(backup.filename)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Ya, Hapus
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Export */}
      <Card>
        <div ref={exportSectionRef} />
        <CardHeader>
          <CardTitle>{id.settings.exportDatabase}</CardTitle>
          <CardDescription>{id.settings.exportDatabaseDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-path">Lokasi File</Label>
            <Input
              id="export-path"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              placeholder="C:\backup\kasir-backup.db"
            />
          </div>
          <Button onClick={handleExportWithDialog} disabled={isExporting}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Mengexport..." : id.settings.exportDatabase}
          </Button>
        </CardContent>
      </Card>

      {/* Manual Import */}
      <Card>
        <CardHeader>
          <CardTitle>{id.settings.importDatabase}</CardTitle>
          <CardDescription>{id.settings.importDatabaseDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-path">Lokasi File Backup</Label>
            <Input
              id="import-path"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="C:\backup\kasir-backup.db"
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isImporting}>
                <Upload className="mr-2 h-4 w-4" />
                {isImporting ? "Mengimport..." : id.settings.importDatabase}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{id.settings.importDatabase}</AlertDialogTitle>
                <AlertDialogDescription>{id.settings.importConfirm}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={handleImportWithDialog}>
                  Ya, Import
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
