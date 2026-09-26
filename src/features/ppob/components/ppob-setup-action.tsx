import { useLocation, useNavigate } from "react-router-dom"
import { Button } from "@heroui/react"
import { Settings } from "lucide-react"

import { useAuthStore } from "@/features/auth"

/**
 * The server's answer for every Mitra call while PPOB is switched off or has no
 * phone number (`services/ppob/auth.rs`). It is a `Validation` error like many
 * others, so the sentence is the only thing that tells this case apart.
 */
const NOT_CONFIGURED_PREFIX = "PPOB belum dikonfigurasi"

function isPpobNotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(NOT_CONFIGURED_PREFIX)
}

/**
 * "Atur Mitra" beside "Coba lagi" in a PPOB `LoadError` (its `secondaryAction`),
 * shown only when the failure is "PPOB belum dikonfigurasi" and the user is an
 * admin. Retrying cannot fix that; the settings page can, and from a service
 * sub-page it is otherwise two clicks away (back, then Pengaturan).
 *
 * Only inside `/ppob`: the same service forms sit in the cashier's quick-access
 * panel, and a button there that leaves the cashier mid-sale would be a trap.
 */
export function PpobSetupAction({ error }: { error: unknown }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")

  if (!isAdmin || !pathname.startsWith("/ppob") || !isPpobNotConfigured(error)) return null

  return (
    <Button size="sm" onPress={() => navigate("/ppob/settings")}>
      <Settings />
      Atur Mitra
    </Button>
  )
}
