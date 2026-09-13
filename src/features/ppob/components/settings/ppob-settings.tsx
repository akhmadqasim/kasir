import { useNavigate } from "react-router-dom"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { id } from "@/i18n/id"
import { ConnectionCard } from "./connection-card"
import { MarkupCard } from "./markup-card"
import { usePpobSettingsForm } from "./use-ppob-settings-form"

/**
 * Sub-halaman pengaturan Mitra Indogrosir (`/ppob/settings`), dulu tab di
 * Pengaturan. Rutenya di balik `AdminRouteGuard`, sama seperti `/settings`.
 * Dipusatkan di `max-w-5xl` seperti halaman pengaturan: formulir sepanjang
 * ini tidak enak dibaca kalau melebar ke seluruh monitor.
 */
export function PpobSettings() {
  const navigate = useNavigate()
  const form = usePpobSettingsForm()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SubpageHeader title={id.ppob.settingsTitle} onBack={() => navigate("/ppob")} />
      <ConnectionCard form={form} />
      <MarkupCard form={form} />
    </div>
  )
}
