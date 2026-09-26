import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Archive, RotateCcw, Trash2 } from "lucide-react"
import { AlertDialog, Button, Card, Chip, Spinner, Table } from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { InfoPanel } from "@/components/info-panel"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { toast } from "@/lib/toast"
import { formatDateTime, formatFileSize } from "@/lib/format"
import { useApiMutation } from "@/hooks/use-api"
import { deleteBackup, restoreBackup } from "@/lib/api/backups"
import { queryKeys } from "@/lib/api/query-keys"
import { id } from "@/i18n/id"
import type { BackupInfo } from "../../types"

/** Aksi yang menunggu konfirmasi pada satu baris backup. */
interface PendingBackupAction {
  action: "restore" | "delete"
  filename: string
}

export interface BackupListCardProps {
  backups: BackupInfo[]
  /** First load: skeleton rows instead of "Belum ada backup". */
  isLoading?: boolean
  /** The list failed; the tab's banner carries the message and the retry. */
  isError?: boolean
}

const COLUMN_COUNT = 4

/**
 * Semua salinan backup yang tersimpan di komputer ini, dari yang terbaru.
 * Pulihkan mengganti seluruh database dengan salah satunya, sama merusaknya
 * dengan menghapus — keduanya lewat `AlertDialog` yang bilang persis apa yang
 * akan hilang, bukan lewat sepasang tombol yang berbeda satu sama lain.
 *
 * Satu dialog untuk semua baris, bukan sepasang per baris: daftarnya bisa
 * panjang, dan React Aria memasang focus scope + portal untuk setiap
 * `AlertDialog` yang dirender. Baris mana yang dikonfirmasi dibawa state.
 */
export function BackupListCard({
  backups,
  isLoading = false,
  isError = false,
}: BackupListCardProps) {
  const queryClient = useQueryClient()
  const [pendingBackup, setPendingBackup] = useState<PendingBackupAction | null>(null)

  const deleteBackupMutation = useApiMutation<void, string>(deleteBackup, {
    onSuccess: () => {
      toast.success(id.backup.deleted)
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
    },
    onError: (error) => toast.error(error.message),
  })

  const restoreBackupMutation = useApiMutation<string, string>(restoreBackup, {
    // Nothing to refetch: the server only stages the backup (`services/backup.rs`
    // `restore`), and the live database is swapped at the next launch.
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

  const isDeletePending = pendingBackup?.action === "delete"
  // A restore replaces the whole database; nothing else on the list should run
  // while it does, and a second press of the same row must not queue another.
  const isRestoring = restoreBackupMutation.isPending
  const busyFilename = isRestoring
    ? restoreBackupMutation.variables
    : deleteBackupMutation.isPending
      ? deleteBackupMutation.variables
      : null

  const renderEmptyState = () =>
    isError ? (
      <LoadError icon={<Archive />} title={id.loadFailed.backups} />
    ) : (
      <NoData icon={<Archive />} title={id.empty.backups}>
        {id.empty.backupsHint}
      </NoData>
    )

  return (
    <Card>
      <Card.Header>
        <CardHeading>Daftar Backup</CardHeading>
        <Card.Description>
          Pulihkan salah satu untuk mengembalikan database ke titik itu, atau hapus yang sudah tidak
          diperlukan untuk menghemat ruang.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <Table variant="secondary">
          <Table.ScrollContainer className="max-h-[300px]">
            <Table.Content aria-label="Daftar Backup">
              <Table.Header>
                <Table.Column isRowHeader>File</Table.Column>
                <Table.Column>Dibuat</Table.Column>
                <Table.Column className="text-right">Ukuran</Table.Column>
                <Table.Column className="text-right">Aksi</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={renderEmptyState}>
                {isLoading ? (
                  <TableSkeletonRows columns={COLUMN_COUNT} rows={3} />
                ) : (
                  backups.map((backup, i) => (
                    <Table.Row
                      key={backup.filename}
                      id={backup.filename}
                      textValue={backup.filename}
                    >
                      <Table.Cell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono break-all">{backup.filename}</span>
                          {i === 0 && <Chip size="sm">Terbaru</Chip>}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap tabular-nums">
                        {formatDateTime(backup.created_at)}
                      </Table.Cell>
                      <Table.Cell className="text-right whitespace-nowrap tabular-nums">
                        {formatFileSize(backup.size_bytes)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {/* Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI
                          (DESIGN.md §5.4). Pulihkan juga menimpa database, jadi
                          sama merusaknya dengan hapus. */}
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`Pulihkan backup ${backup.filename}`}
                            isDisabled={isRestoring || busyFilename === backup.filename}
                            isIconOnly
                            isPending={isRestoring && busyFilename === backup.filename}
                            size="sm"
                            variant="danger-soft"
                            onPress={() =>
                              setPendingBackup({ action: "restore", filename: backup.filename })
                            }
                          >
                            {({ isPending }) =>
                              isPending ? <Spinner color="current" size="sm" /> : <RotateCcw />
                            }
                          </Button>
                          <Button
                            aria-label={`Hapus backup ${backup.filename}`}
                            isDisabled={isRestoring || busyFilename === backup.filename}
                            isIconOnly
                            isPending={!isRestoring && busyFilename === backup.filename}
                            size="sm"
                            variant="danger-soft"
                            onPress={() =>
                              setPendingBackup({ action: "delete", filename: backup.filename })
                            }
                          >
                            {({ isPending }) =>
                              isPending ? <Spinner color="current" size="sm" /> : <Trash2 />
                            }
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>

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
                <p>Berkas backup ini dihapus dari komputer kasir dan tidak bisa dikembalikan.</p>
              ) : (
                <p>
                  Database saat ini diganti dengan isi backup ini, jadi transaksi setelah backup
                  dibuat akan hilang. Buat backup terbaru dulu bila perlu. Aplikasi perlu dijalankan
                  ulang setelah pemulihan.
                </p>
              )}
              <InfoPanel>
                <span className="font-mono break-all text-foreground">
                  {pendingBackup?.filename}
                </span>
              </InfoPanel>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Batal
              </Button>
              <Button variant="danger" onPress={confirmPendingBackup}>
                {isDeletePending ? "Ya, Hapus" : "Ya, Pulihkan"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </Card>
  )
}
