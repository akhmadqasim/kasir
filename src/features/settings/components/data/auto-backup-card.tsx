import { useState } from "react"
import { Save } from "lucide-react"
import { Card } from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { LoadError } from "@/components/load-error"
import { OptionSelect, type SelectOption } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { useApiQuery } from "@/hooks/use-api"
import { getAppSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useSaveAppSettingsSection } from "../../hooks/use-save-app-settings-section"
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

/**
 * The server accepts any interval from 1 to 168 hours, so a value set before
 * this list existed (or by hand) may not be one of its options. Without its own
 * entry the field would render empty and look unset.
 */
function withCurrent(options: SelectOption[], value: number, unit: string): SelectOption[] {
  const key = String(value)
  if (options.some((option) => option.key === key)) return options
  return [...options, { key, label: `${value} ${unit}` }].sort(
    (a, b) => Number(a.key) - Number(b.key),
  )
}

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
  const [intervalHours, setIntervalHours] = useState(3)
  const [retentionDays, setRetentionDays] = useState(90)
  const [initialized, setInitialized] = useState(false)

  const settingsQuery = useApiQuery<AppSettings>(queryKeys.settings.app, getAppSettings)

  if (settingsQuery.data && !initialized) {
    setIntervalHours(settingsQuery.data.backup.interval_hours)
    setRetentionDays(settingsQuery.data.backup.retention_days)
    setInitialized(true)
  }

  const saveMutation = useSaveAppSettingsSection("backup", {
    onSaved: () => toast.success(id.backup.scheduleSaved),
  })

  const isReady = settingsQuery.isSuccess && initialized
  const intervalOptions = withCurrent(INTERVAL_OPTIONS, intervalHours, "jam")
  const retentionOptions = withCurrent(RETENTION_OPTIONS, retentionDays, "hari")

  return (
    <Card>
      <Card.Header>
        <CardHeading>Backup Otomatis</CardHeading>
        <Card.Description>
          Backup berjalan sendiri sesuai jadwal ini — ubah kalau toko butuh cadangan lebih sering
          atau perlu menyimpan riwayatnya lebih lama.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {settingsQuery.isError && (
          <LoadError
            isRetrying={settingsQuery.isFetching}
            title={id.loadFailed.backupSchedule}
            onRetry={() => void settingsQuery.refetch()}
          >
            {settingsQuery.error.message}
          </LoadError>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionSelect
            fullWidth
            isDisabled={!isReady}
            label="Interval backup otomatis"
            options={intervalOptions}
            value={String(intervalHours)}
            variant="secondary"
            onChange={(value) => value !== null && setIntervalHours(Number(value))}
          />
          <OptionSelect
            fullWidth
            isDisabled={!isReady}
            label="Simpan backup selama"
            options={retentionOptions}
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
          onPress={() =>
            saveMutation.mutate({ interval_hours: intervalHours, retention_days: retentionDays })
          }
        >
          <Save />
          {id.common.save}
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
