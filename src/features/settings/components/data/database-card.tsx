import { RefreshCw } from "lucide-react"
import { Card } from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { id } from "@/i18n/id"
import { formatDateTime, formatFileSize } from "@/lib/format"
import { useCreateBackupMutation } from "../../hooks/use-backup"
import type { BackupStatus, DatabaseInfo } from "../../types"

export interface DatabaseCardProps {
  dbInfo: DatabaseInfo | undefined
  backupStatus: BackupStatus | undefined
}

/**
 * Kartu pertama yang harus dijawab: di mana data toko disimpan, seberapa
 * besar, dan kapan terakhir dicadangkan. "Backup Sekarang" naik jadi satu-
 * satunya tombol primary di tab ini (DESIGN.md §4.1, "satu primary per
 * layar") karena inilah aksi yang paling sering dicari pemilik toko di sini —
 * sebelumnya tombol yang sama tertanam sebagai `secondary` di kartu jadwal
 * otomatis, bukan di kartu yang menjelaskan apa yang sedang di-backup.
 *
 * Jumlah dan total ukuran backup, yang sebelumnya tiga `StatCard` terpisah
 * yang mengulang angka dari kartu-kartu di bawahnya, pindah ke sini sebagai
 * baris `SummaryList` — kartu di dalam kartu adalah bingkai ganda (DESIGN.md
 * §4.2), dan angkanya memang tentang database ini juga.
 */
export function DatabaseCard({ dbInfo, backupStatus }: DatabaseCardProps) {
  const createBackupMutation = useCreateBackupMutation()

  return (
    <Card>
      <Card.Header>
        <Card.Title>Database</Card.Title>
        <Card.Description>
          Lokasi dan ukuran file tempat seluruh data transaksi toko tersimpan — cadangkan sekarang
          sebelum melakukan perubahan besar, misalnya sebelum update aplikasi.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <SummaryList
          items={[
            {
              label: id.settings.databaseSize,
              value: dbInfo ? formatFileSize(dbInfo.size_bytes) : "—",
            },
            {
              label: id.settings.databasePath,
              value: dbInfo?.path ?? "—",
              tone: "mono",
            },
            {
              label: "Backup terakhir",
              value: backupStatus?.last_backup
                ? `${formatDateTime(backupStatus.last_backup.created_at)} — ${formatFileSize(backupStatus.last_backup.size_bytes)}`
                : "Belum ada backup",
            },
            {
              label: "Backup tersimpan",
              value: backupStatus
                ? `${backupStatus.total_backups} berkas — ${formatFileSize(backupStatus.total_size_bytes)}`
                : "—",
            },
          ]}
        />
      </Card.Content>
      <Card.Footer>
        <PendingButton
          isPending={createBackupMutation.isPending}
          onPress={() => createBackupMutation.mutate(undefined)}
        >
          <RefreshCw />
          Backup Sekarang
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
