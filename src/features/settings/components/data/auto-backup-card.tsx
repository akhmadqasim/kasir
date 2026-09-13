import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { Card } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { toast } from "@/lib/toast"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import { getAppSettings, toUpdateAppSettingsInput, updateAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { AppSettings, BackupStatus } from "../../types"

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

export interface AutoBackupCardProps {
  backupStatus: BackupStatus | undefined
}

/**
 * Seberapa sering backup otomatis dibuat dan berapa lama salinannya disimpan.
 *
 * Tidak ada saklar nyala/mati di sini: server tidak punya jalan untuk
 * mematikan backup otomatis sepenuhnya, hanya rentang intervalnya yang bisa
 * diatur (`BackupSettings::validate` di `domain/backup.rs` menolak interval di
 * luar 1–168 jam). Menaruh `Switch` yang tidak tersambung ke apa pun hanya
 * menjanjikan kendali yang tidak ada (DESIGN.md §2).
 *
 * Mengikuti pola simpan eksplisit dari tab pengaturan lain (mis.
 * `SalesSettingsTab`) alih-alih menyimpan setiap kali kolom pilihnya diganti:
 * tombol Simpan tetap mati sampai pengaturan saat ini selesai dimuat, supaya
 * tidak ada perubahan yang terkirim menimpa nilai yang belum sempat terbaca.
 */
export function AutoBackupCard({ backupStatus }: AutoBackupCardProps) {
  const queryClient = useQueryClient()
  const [intervalHours, setIntervalHours] = useState(3)
  const [retentionDays, setRetentionDays] = useState(90)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  if (settingsQuery.data && !initialized) {
    setIntervalHours(settingsQuery.data.backup.interval_hours)
    setRetentionDays(settingsQuery.data.backup.retention_days)
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, void>(
    () => {
      // Server menulis ulang keempat blok sekaligus, jadi tiga blok yang
      // bukan urusan kartu ini harus dikirim balik apa adanya.
      const current = settingsQuery.data
      if (!current) {
        return Promise.reject(new Error("Pengaturan belum dimuat, coba lagi sebentar"))
      }
      return updateAppSettings({
        ...toUpdateAppSettingsInput(current),
        backup: { interval_hours: intervalHours, retention_days: retentionDays },
      })
    },
    {
      onSuccess: () => {
        toast.success("Pengaturan backup berhasil disimpan. Perubahan berlaku setelah restart.")
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.app })
        queryClient.invalidateQueries({ queryKey: queryKeys.backups.status })
      },
      onError: (error) => toast.error(error.message),
    },
  )

  const isReady = settingsQuery.isSuccess && initialized

  return (
    <Card>
      <Card.Header>
        <Card.Title>Backup Otomatis</Card.Title>
        <Card.Description>
          Backup berjalan sendiri sesuai jadwal ini — ubah kalau toko butuh cadangan lebih sering
          atau perlu menyimpan riwayatnya lebih lama.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionSelect
            fullWidth
            label="Interval backup otomatis"
            options={INTERVAL_OPTIONS}
            value={String(intervalHours)}
            variant="secondary"
            onChange={(value) => value !== null && setIntervalHours(Number(value))}
          />
          <OptionSelect
            fullWidth
            label="Retensi backup"
            options={RETENTION_OPTIONS}
            value={String(retentionDays)}
            variant="secondary"
            onChange={(value) => value !== null && setRetentionDays(Number(value))}
          />
        </div>

        {backupStatus?.backup_dir && (
          <SummaryList
            layout="grid"
            items={[{ label: "Folder", value: backupStatus.backup_dir, tone: "mono" }]}
          />
        )}
      </Card.Content>
      <Card.Footer>
        {/* `secondary`, bukan bawaannya: "Backup Sekarang" di kartu Database
            sudah jadi satu-satunya tombol primary di tab ini. */}
        <PendingButton
          isDisabled={!isReady}
          isPending={saveMutation.isPending}
          variant="secondary"
          onPress={() => saveMutation.mutate(undefined)}
        >
          <Save />
          Simpan
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
