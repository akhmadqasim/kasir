import { useRef, useState, type ChangeEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  Select,
  Table,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import { formatDateTime } from "@/lib/format"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { errorMessage } from "@/lib/api/client"
import {
  deleteBackup,
  exportDatabase,
  getBackupStatus,
  importDatabase,
  listBackups,
  restoreBackup,
} from "@/lib/api/backups"
import {
  getAppSettings,
  getDatabaseInfo,
  toUpdateAppSettingsInput,
  updateAppSettings,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useCreateBackupMutation } from "../hooks/use-backup"
import type { AppSettings, BackupInfo, BackupStatus, DatabaseInfo } from "../types"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/*
 * Export and import used to go through the Tauri file dialog, which handed the
 * backend a path the client had chosen. That was already a path traversal
 * waiting to happen, and it stopped being possible at all once the client can be
 * a browser on another machine — the till's filesystem is not the tablet's.
 *
 * Both are now ordinary web transfers. Export is a download: the server
 * checkpoints the WAL, streams `kasir.db`, and names it in `Content-Disposition`
 * for the browser's download folder. Import is a `<input type="file">` and a
 * multipart upload whose filename the server ignores entirely.
 */

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

/** Aksi yang menunggu konfirmasi pada satu baris backup. */
interface PendingBackupAction {
  action: "restore" | "delete"
  filename: string
}

function BackupSettingsInline({
  intervalHours,
  retentionDays,
}: {
  intervalHours: number
  retentionDays: number
}) {
  const queryClient = useQueryClient()

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  const updateMutation = useApiMutation<void, AppSettings>(
    (settings) => updateAppSettings(toUpdateAppSettingsInput(settings)),
    {
      onSuccess: () => {
        toast.success("Pengaturan backup berhasil disimpan. Perubahan berlaku setelah restart.")
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.app })
        queryClient.invalidateQueries({ queryKey: queryKeys.backups.status })
      },
      onError: (error) => toast.error(error.message),
    },
  )

  const handleChange = (field: "interval_hours" | "retention_days", value: string) => {
    // Same guard as the other tabs: the backend rewrites all four blocks, so a change
    // sent before the query resolves would post the missing blocks as defaults.
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

  const isDisabled = updateMutation.isPending || !settingsQuery.data

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-default/50 p-3">
      <Settings2 className="h-4 w-4 shrink-0 text-muted" />
      <div className="flex items-center gap-2">
        {/* Teks label dibiarkan sebagai `span` agar barisnya tetap satu baris; nama
            aksesibilitasnya dibawa `aria-label`, seperti bar filter di layar lain. */}
        <span className="text-sm whitespace-nowrap">Interval:</span>
        <Select
          aria-label="Interval backup otomatis"
          className="w-[100px]"
          isDisabled={isDisabled}
          value={String(intervalHours)}
          onChange={(value) => value !== null && handleChange("interval_hours", String(value))}
        >
          <Select.Trigger className="h-8">
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {INTERVAL_OPTIONS.map((opt) => (
                <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                  <Label>{opt.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm whitespace-nowrap">Retensi:</span>
        <Select
          aria-label="Retensi backup otomatis"
          className="w-[110px]"
          isDisabled={isDisabled}
          value={String(retentionDays)}
          onChange={(value) => value !== null && handleChange("retention_days", String(value))}
        >
          <Select.Trigger className="h-8">
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {RETENTION_OPTIONS.map((opt) => (
                <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                  <Label>{opt.label}</Label>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </div>
  )
}

export function DataTab() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [pendingBackup, setPendingBackup] = useState<PendingBackupAction | null>(null)
  /** The chosen upload, held between picking the file and confirming the import. */
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const queryClient = useQueryClient()
  const exportSectionRef = useRef<HTMLDivElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const dbInfoQuery = useApiQuery<DatabaseInfo>(queryKeys.settings.database, getDatabaseInfo)

  const backupStatusQuery = useApiQuery<BackupStatus>(queryKeys.backups.status, getBackupStatus)

  const backupListQuery = useApiQuery<BackupInfo[]>(queryKeys.backups.list, listBackups)
  const createBackupMutation = useCreateBackupMutation()

  const deleteBackupMutation = useApiMutation<void, string>(deleteBackup, {
    onSuccess: () => {
      toast.success("Backup berhasil dihapus")
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
    },
    onError: (error) => toast.error(error.message),
  })

  const restoreBackupMutation = useApiMutation<string, string>(restoreBackup, {
    onSuccess: (message) => toast.success(message),
    onError: (error) => toast.error(error.message),
  })

  const confirmPendingBackup = () => {
    if (!pendingBackup) return
    if (pendingBackup.action === "delete") {
      deleteBackupMutation.mutate(pendingBackup.filename)
    } else {
      restoreBackupMutation.mutate(pendingBackup.filename)
    }
    setPendingBackup(null)
  }

  /** Stream the live database to the browser's download folder. */
  const handleExport = async () => {
    setIsExporting(true)
    try {
      const filename = await exportDatabase()
      toast.success(`${id.settings.exportSuccess}: ${filename}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsExporting(false)
    }
  }

  /**
   * Picking a file does not import it. The file is held until the confirmation
   * dialog is answered, because this replaces the whole shop's database.
   */
  const handleImportFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    // Reset the input so choosing the same file twice still fires `change`.
    event.target.value = ""
    if (file) setPendingImportFile(file)
  }

  const handleImportConfirmed = async () => {
    const file = pendingImportFile
    setPendingImportFile(null)
    if (!file) return

    setIsImporting(true)
    try {
      const message = await importDatabase(file)
      toast.success(message || id.settings.importSuccess)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsImporting(false)
    }
  }

  const status = backupStatusQuery.data
  const backups = backupListQuery.data ?? []
  const showSafetyBanner = !!dbInfoQuery.data && !!backupStatusQuery.data
  const isDeletePending = pendingBackup?.action === "delete"

  return (
    <div className="space-y-4">
      {showSafetyBanner && (
        <Alert status="accent">
          <Alert.Indicator>
            <ShieldCheck className="h-5 w-5" />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title className="text-base">
              Update normal tidak menghapus data kasir.
            </Alert.Title>
            <Alert.Description>
              Database disimpan terpisah dari file aplikasi dan backup otomatis tetap berjalan. Jika
              pindah dari versi debug/portable ke installer, gunakan Export Database lalu Import
              Database.
            </Alert.Description>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                isDisabled={createBackupMutation.isPending}
                onPress={() => createBackupMutation.mutate(undefined)}
              >
                <Shield className="mr-2 h-4 w-4" />
                {createBackupMutation.isPending ? "Membuat backup..." : "Backup Sekarang"}
              </Button>
              <Button
                variant="outline"
                onPress={() =>
                  exportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" />
                Ke Export Database
              </Button>
            </div>
          </Alert.Content>
        </Alert>
      )}

      {/* Database Info */}
      <Card>
        <Card.Header>
          <Card.Title className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Database
          </Card.Title>
        </Card.Header>
        <Card.Content className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted">{id.settings.databaseSize}</span>
            <span className="font-medium">
              {dbInfoQuery.data ? formatFileSize(dbInfoQuery.data.size_bytes) : "—"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">{id.settings.databasePath}</span>
            <span className="max-w-[300px] truncate font-mono text-xs">
              {dbInfoQuery.data?.path ?? "—"}
            </span>
          </div>
        </Card.Content>
      </Card>

      {/* Auto Backup Status & Settings */}
      <Card>
        <Card.Header>
          <Card.Title className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Backup Otomatis
          </Card.Title>
          <Card.Description>
            Backup otomatis setiap {status?.settings.interval_hours ?? 3} jam. Tersimpan selama{" "}
            {status?.settings.retention_days ?? 90} hari, file terkompresi (gzip).
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          {/* Settings */}
          <BackupSettingsInline
            intervalHours={status?.settings.interval_hours ?? 3}
            retentionDays={status?.settings.retention_days ?? 90}
          />

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{status?.total_backups ?? 0}</div>
              <div className="text-xs text-muted">Total Backup</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">
                {status ? formatFileSize(status.total_size_bytes) : "—"}
              </div>
              <div className="text-xs text-muted">Total Ukuran</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{status?.settings.retention_days ?? 90}</div>
              <div className="text-xs text-muted">Hari Retensi</div>
            </div>
          </div>

          {status?.last_backup && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4" />
              Backup terakhir: {formatDateTime(status.last_backup.created_at)} —{" "}
              {formatFileSize(status.last_backup.size_bytes)}
            </div>
          )}

          {status?.backup_dir && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <FolderOpen className="h-4 w-4" />
              <span className="truncate font-mono text-xs">{status.backup_dir}</span>
            </div>
          )}

          <Button
            isDisabled={createBackupMutation.isPending}
            variant="outline"
            onPress={() => createBackupMutation.mutate(undefined)}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${createBackupMutation.isPending ? "animate-spin" : ""}`}
            />
            {createBackupMutation.isPending ? "Membuat backup..." : "Backup Sekarang"}
          </Button>
        </Card.Content>
      </Card>

      {/* Backup List */}
      {backups.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title>Daftar Backup</Card.Title>
            <Card.Description>
              {backups.length} backup tersedia. Backup lama otomatis dihapus setelah{" "}
              {status?.settings.retention_days ?? 90} hari.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Table variant="secondary">
              <Table.ScrollContainer className="max-h-[300px]">
                <Table.Content aria-label="Daftar Backup">
                  <Table.Header>
                    <Table.Column isRowHeader>File</Table.Column>
                    <Table.Column className="text-right">Ukuran</Table.Column>
                    <Table.Column className="text-right">Aksi</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {backups.map((backup, i) => (
                      <Table.Row
                        key={backup.filename}
                        id={backup.filename}
                        textValue={backup.filename}
                      >
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{backup.filename}</span>
                            {i === 0 && <Chip size="sm">Terbaru</Chip>}
                          </div>
                        </Table.Cell>
                        <Table.Cell className="text-right text-sm">
                          {formatFileSize(backup.size_bytes)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              aria-label={`Pulihkan backup ${backup.filename}`}
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() =>
                                setPendingBackup({ action: "restore", filename: backup.filename })
                              }
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button
                              aria-label={`Hapus backup ${backup.filename}`}
                              className="text-danger"
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() =>
                                setPendingBackup({ action: "delete", filename: backup.filename })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
      )}

      {/* Manual Export */}
      <Card>
        <div ref={exportSectionRef} />
        <Card.Header>
          <Card.Title>{id.settings.exportDatabase}</Card.Title>
          <Card.Description>{id.settings.exportDatabaseDesc}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          <p className="text-sm text-muted">
            Berkas database diunduh oleh browser ini. Di jendela aplikasi kasir, berkas masuk ke
            folder unduhan PC kasir.
          </p>
          <Button isDisabled={isExporting} onPress={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Mengexport..." : id.settings.exportDatabase}
          </Button>
        </Card.Content>
      </Card>

      {/* Manual Import */}
      <Card>
        <Card.Header>
          <Card.Title>{id.settings.importDatabase}</Card.Title>
          <Card.Description>{id.settings.importDatabaseDesc}</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          <p className="text-sm text-muted">
            Pilih berkas <code>.db</code> hasil export. Berkasnya diunggah ke PC kasir dan dipasang
            saat aplikasi dijalankan berikutnya.
          </p>
          {/* Hidden on purpose: the native file input cannot be styled to match
              the rest of the screen, and the button below opens it. */}
          <input
            ref={importInputRef}
            accept=".db,application/vnd.sqlite3,application/x-sqlite3"
            className="hidden"
            onChange={handleImportFileChosen}
            type="file"
          />
          <Button
            isDisabled={isImporting}
            variant="danger"
            onPress={() => importInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {isImporting ? "Mengimport..." : id.settings.importDatabase}
          </Button>
        </Card.Content>
      </Card>

      {/* Satu dialog untuk semua baris backup, bukan sepasang per baris: daftar backup
          bisa panjang, dan React Aria memasang focus scope + portal untuk setiap
          AlertDialog yang dirender. Baris mana yang dikonfirmasi dibawa state, persis
          pola `deactivateUser` di halaman manajemen user. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={pendingBackup !== null}
        onOpenChange={(open) => !open && setPendingBackup(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={isDeletePending ? "Hapus Backup" : "Pulihkan Backup"}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                {isDeletePending ? "Hapus Backup" : "Pulihkan Backup"}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {isDeletePending ? (
                <p className="text-sm text-muted">
                  Hapus backup <strong>{pendingBackup?.filename}</strong>? Tindakan ini tidak dapat
                  dibatalkan.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Database akan diganti dengan backup <strong>{pendingBackup?.filename}</strong>.
                  Data saat ini akan hilang. Pastikan sudah membuat backup terbaru. Aplikasi perlu
                  di-restart setelah pemulihan.
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="outline" onPress={() => setPendingBackup(null)}>
                Batal
              </Button>
              <Button
                variant={isDeletePending ? "danger" : "primary"}
                onPress={confirmPendingBackup}
              >
                {isDeletePending ? "Ya, Hapus" : "Ya, Pulihkan"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* Opens once a file has been picked, not when the button is pressed: the
          name of the file being installed is the thing worth confirming. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={pendingImportFile !== null}
        onOpenChange={(open) => !open && setPendingImportFile(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.settings.importDatabase}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.settings.importDatabase}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-2">
              <p className="text-sm text-muted">{id.settings.importConfirm}</p>
              {pendingImportFile && (
                <p className="text-sm font-medium">
                  {pendingImportFile.name} ({formatFileSize(pendingImportFile.size)})
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="outline" onPress={() => setPendingImportFile(null)}>
                Batal
              </Button>
              <Button variant="danger" onPress={() => void handleImportConfirmed()}>
                Ya, Import
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}
