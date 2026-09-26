import { StatusBadge } from "@/components/status-badge"
import { normalizeStatus } from "./history-utils"

/**
 * A vendor status (history row or mutasi) as a badge. A status nothing here
 * recognises is shown as-is rather than hidden.
 */
export function VendorStatusBadge({ status, size }: { status: string | null; size?: "sm" }) {
  switch (normalizeStatus(status)) {
    case "sukses":
      return (
        <StatusBadge status="success" size={size}>
          Sukses
        </StatusBadge>
      )
    case "gagal":
      return (
        <StatusBadge status="error" size={size}>
          Gagal
        </StatusBadge>
      )
    case "proses":
      return (
        <StatusBadge status="warning" size={size}>
          Proses
        </StatusBadge>
      )
    default:
      return (
        <StatusBadge status="neutral" size={size}>
          {status ?? "-"}
        </StatusBadge>
      )
  }
}
