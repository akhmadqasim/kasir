import { ShieldCheck } from "lucide-react"
import { Alert, Button } from "@heroui/react"

import { id } from "@/i18n/id"
import { useApiQuery } from "@/hooks/use-api"
import { getDatabaseInfo } from "@/lib/api/settings"
import { getBackupStatus, listBackups } from "@/lib/api/backups"
import { queryKeys } from "@/lib/api/query-keys"
import type { BackupInfo, BackupStatus, DatabaseInfo } from "../types"
import { AutoBackupCard } from "./data/auto-backup-card"
import { BackupListCard } from "./data/backup-list-card"
import { DatabaseCard } from "./data/database-card"
import { ImportExportCard } from "./data/import-export-card"

/**
 * Tab Data: satu cerita atas-ke-bawah, bukan empat kartu yang bersaing.
 * Database dulu (apa yang sedang dilindungi dan aksi cadangkan-sekarang),
 * lalu jadwal otomatisnya, lalu daftar salinan yang sudah ada, lalu jalan
 * keluar-masuk lewat berkas. Tidak ada "Zona Berbahaya"/reset di sini —
 * aplikasi ini memang tidak punya aksi reset database, jadi kartu itu tidak
 * ditambahkan hanya supaya susunannya terasa lengkap.
 */
export function DataTab() {
  const dbInfoQuery = useApiQuery<DatabaseInfo>(queryKeys.settings.database, getDatabaseInfo)
  const backupStatusQuery = useApiQuery<BackupStatus>(queryKeys.backups.status, getBackupStatus)
  const backupListQuery = useApiQuery<BackupInfo[]>(queryKeys.backups.list, listBackups)

  const showSafetyBanner = !!dbInfoQuery.data && !!backupStatusQuery.data

  // One banner for the three reads, not three: the cards below keep drawing
  // "—" for what is missing, and this says why and offers the way back.
  const failedQuery = [dbInfoQuery, backupStatusQuery, backupListQuery].find((q) => q.isError)
  const retryFailed = () => {
    for (const query of [dbInfoQuery, backupStatusQuery, backupListQuery]) {
      if (query.isError) void query.refetch()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {failedQuery?.error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{id.loadFailed.databaseInfo}</Alert.Title>
            <Alert.Description>{failedQuery.error.message}</Alert.Description>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onPress={retryFailed}>
                {id.common.retry}
              </Button>
            </div>
          </Alert.Content>
        </Alert>
      )}

      {/* Pesan saja, tanpa tombol: "Backup Sekarang" sudah ada di kartu
          Database di bawah. */}
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

      <DatabaseCard
        backupStatus={backupStatusQuery.data}
        dbInfo={dbInfoQuery.data}
        isBackupStatusLoading={backupStatusQuery.isPending}
        isDbInfoLoading={dbInfoQuery.isPending}
      />
      <AutoBackupCard backupStatus={backupStatusQuery.data} />
      <BackupListCard
        backups={backupListQuery.data ?? []}
        isError={backupListQuery.isError}
        isLoading={backupListQuery.isPending}
      />
      <ImportExportCard />
    </div>
  )
}
