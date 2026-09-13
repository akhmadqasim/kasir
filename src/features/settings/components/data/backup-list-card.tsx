import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Archive, RotateCcw, Trash2 } from "lucide-react"
import { AlertDialog, Button, Card, Chip, Table } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { toast } from "@/lib/toast"
import { formatFileSize } from "@/lib/format"
import { useApiMutation } from "@/hooks/use-api"
import { deleteBackup, restoreBackup } from "@/lib/api/backups"
import { queryKeys } from "@/lib/api/query-keys"
import type { BackupInfo } from "../../types"

/** Aksi yang menunggu konfirmasi pada satu baris backup. */
interface PendingBackupAction {
  action: "restore" | "delete"
  filename: string
}

export interface BackupListCardProps {
  backups: BackupInfo[]
}

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
export function BackupListCard({ backups }: BackupListCardProps) {
  const queryClient = useQueryClient()
  const [pendingBackup, setPendingBackup] = useState<PendingBackupAction | null>(null)

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

  const isDeletePending = pendingBackup?.action === "delete"

  return (
    <Card>
      <Card.Header>
        <Card.Title>Daftar Backup</Card.Title>
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
                <Table.Column className="text-right">Ukuran</Table.Column>
                <Table.Column className="text-right">Aksi</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={() => <NoData icon={<Archive />} title="Belum ada backup" />}>
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
