import { useRef, useState, type ChangeEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Download, Upload, RefreshCw, Trash2, RotateCcw, ShieldCheck } from "lucide-react"
import { Alert, AlertDialog, Button, Card, Chip, Table } from "@heroui/react"

import { toast } from "@/lib/toast"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { StatCard } from "@/components/stat-card"
import { SummaryList } from "@/components/summary-list"
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
import { formatFileSize } from "../lib/format"
import type { AppSettings, BackupInfo, BackupStatus, DatabaseInfo } from "../types"

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
  { key: "1", label: "1 jam" },
  { key: "2", label: "2 jam" },
  { key: "3", label: "3 jam" },
  { key: "6", label: "6 jam" },
  { key: "12", label: "12 jam" },
  { key: "24", label: "24 jam" },
]

const RETENTION_OPTIONS = [
  { key: "30", label: "30 hari" },
  { key: "60", label: "60 hari" },
  { key: "90", label: "90 hari" },
  { key: "180", label: "180 hari" },
  { key: "365", label: "365 hari" },
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

  // Dua kolom pilih biasa dengan `Label`-nya sendiri, bukan sebaris "Interval:"
  // dan kotak info: susunan kolom isian di kartu pengaturan lain sudah begitu,
  // dan yang tersimpan otomatis begitu diubah tidak perlu terlihat berbeda.
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OptionSelect
        fullWidth
        isDisabled={isDisabled}
        label="Interval backup otomatis"
        options={INTERVAL_OPTIONS}
        value={String(intervalHours)}
        variant="secondary"
        onChange={(value) => value !== null && handleChange("interval_hours", value)}
      />
      <OptionSelect
        fullWidth
        isDisabled={isDisabled}
        label="Retensi backup"
        options={RETENTION_OPTIONS}
        value={String(retentionDays)}
        variant="secondary"
        onChange={(value) => value !== null && handleChange("retention_days", value)}
      />
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
    <div className="flex flex-col gap-4">
      {/* Pesan saja, tanpa tombol: "Backup Sekarang" sudah ada di kartu backup
          di bawah, dan tombol yang menggulung ke kartu export hanya mengulang
          tautan yang tinggal beberapa ratus piksel lagi. */}
      {showSafetyBanner && (
        <Alert status="accent">
          <Alert.Indicator>
            <ShieldCheck />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Update normal tidak menghapus data kasir.</Alert.Title>
            <Alert.Description>
              Database disimpan terpisah dari file aplikasi dan backup otomatis tetap berjalan. Jika
              pindah dari versi debug/portable ke installer, gunakan Export Database lalu Import
              Database.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <Card>
        <Card.Header>
          <Card.Title>Database</Card.Title>
        </Card.Header>
        <Card.Content>
          <SummaryList
            items={[
              {
                label: id.settings.databaseSize,
                value: dbInfoQuery.data ? formatFileSize(dbInfoQuery.data.size_bytes) : "—",
              },
              {
                label: id.settings.databasePath,
                value: dbInfoQuery.data?.path ?? "—",
                tone: "mono",
              },
            ]}
          />
        </Card.Content>
      </Card>

      {/* Angka backup berdiri sebagai baris KPI sendiri, bukan kotak di dalam
          kartu: `StatCard` sudah `Card`, dan kartu di dalam kartu adalah bingkai
          ganda (DESIGN.md §4.2). */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Backup" value={String(status?.total_backups ?? 0)} />
        <StatCard
          label="Total Ukuran"
          value={status ? formatFileSize(status.total_size_bytes) : "—"}
        />
        <StatCard label="Hari Retensi" value={String(status?.settings.retention_days ?? 90)} />
      </div>

      {/* Keterangan "setiap N jam, N hari" tidak diulang di kepala kartu: kedua
          angkanya sudah terbaca di kolom pilihannya dan di kartu KPI di atas. */}
      <Card>
        <Card.Header>
          <Card.Title>Backup Otomatis</Card.Title>
        </Card.Header>
        <Card.Content className="gap-4">
          <BackupSettingsInline
            intervalHours={status?.settings.interval_hours ?? 3}
            retentionDays={status?.settings.retention_days ?? 90}
          />

          {(status?.last_backup || status?.backup_dir) && (
            <SummaryList
              layout="grid"
              items={[
                ...(status.last_backup
                  ? [
                      {
                        label: "Backup terakhir",
                        value: `${formatDateTime(status.last_backup.created_at)} — ${formatFileSize(status.last_backup.size_bytes)}`,
                      },
                    ]
                  : []),
                ...(status.backup_dir
                  ? [{ label: "Folder", value: status.backup_dir, tone: "mono" as const }]
                  : []),
              ]}
            />
          )}
        </Card.Content>
        <Card.Footer>
          <PendingButton
            isPending={createBackupMutation.isPending}
            variant="secondary"
            onPress={() => createBackupMutation.mutate(undefined)}
          >
            <RefreshCw />
            Backup Sekarang
          </PendingButton>
        </Card.Footer>
      </Card>

      {/* Backup List */}
      {backups.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title>Daftar Backup</Card.Title>
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
                            <span className="font-mono">{backup.filename}</span>
                            {i === 0 && <Chip size="sm">Terbaru</Chip>}
                          </div>
                        </Table.Cell>
                        <Table.Cell className="text-right tabular-nums">
                          {formatFileSize(backup.size_bytes)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          {/* Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI
                              (DESIGN.md §5.4). Pulihkan juga menimpa database, jadi
                              sama merusaknya dengan hapus. */}
                          <div className="flex justify-end gap-1">
                            <Button
                              aria-label={`Pulihkan backup ${backup.filename}`}
                              isIconOnly
                              size="sm"
                              variant="danger-soft"
                              onPress={() =>
                                setPendingBackup({ action: "restore", filename: backup.filename })
                              }
                            >
                              <RotateCcw />
                            </Button>
                            <Button
                              aria-label={`Hapus backup ${backup.filename}`}
                              isIconOnly
                              size="sm"
                              variant="danger-soft"
                              onPress={() =>
                                setPendingBackup({ action: "delete", filename: backup.filename })
                              }
                            >
                              <Trash2 />
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

      {/* Aksi kartu di `Card.Footer`, seperti contoh "With Form" di dokumentasi
          Card. Export memajukan pekerjaan (primary); import hanya membuka pemilih
          berkas (secondary) — yang menimpa database adalah "Ya, Import" di
          AlertDialog bawah, dan itu yang `danger`. */}
      <Card>
        <Card.Header>
          <Card.Title>{id.settings.exportDatabase}</Card.Title>
          <Card.Description>{id.settings.exportDatabaseDesc}</Card.Description>
        </Card.Header>
        <Card.Content>
          <p className="text-sm text-muted">
            Berkas database diunduh oleh browser ini. Di jendela aplikasi kasir, berkas masuk ke
            folder unduhan PC kasir.
          </p>
        </Card.Content>
        <Card.Footer>
          <PendingButton isPending={isExporting} onPress={handleExport}>
            <Download />
            {id.settings.exportDatabase}
          </PendingButton>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{id.settings.importDatabase}</Card.Title>
          <Card.Description>{id.settings.importDatabaseDesc}</Card.Description>
        </Card.Header>
        <Card.Content>
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
        </Card.Content>
        <Card.Footer>
          <PendingButton
            isPending={isImporting}
            variant="secondary"
            onPress={() => importInputRef.current?.click()}
          >
            <Upload />
            {id.settings.importDatabase}
          </PendingButton>
        </Card.Footer>
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
                <p>
                  Hapus backup <strong>{pendingBackup?.filename}</strong>? Tindakan ini tidak dapat
                  dibatalkan.
                </p>
              ) : (
                <p>
                  Database akan diganti dengan backup <strong>{pendingBackup?.filename}</strong>.
                  Data saat ini akan hilang. Pastikan sudah membuat backup terbaru. Aplikasi perlu
                  di-restart setelah pemulihan.
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Batal
              </Button>
              {/* Pulihkan juga menimpa database yang sedang dipakai, jadi sama
                  merusaknya dengan hapus — ikon di atas sudah `danger` untuk keduanya. */}
              <Button variant="danger" onPress={confirmPendingBackup}>
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
            <AlertDialog.Body>
              <p>{id.settings.importConfirm}</p>
              {pendingImportFile && (
                <p className="font-medium">
                  {pendingImportFile.name} ({formatFileSize(pendingImportFile.size)})
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
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
