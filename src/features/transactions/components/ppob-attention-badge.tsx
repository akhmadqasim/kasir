import { Chip } from "@heroui/react"

import { id } from "@/i18n/id"
import { usePpobAttention } from "../hooks/use-ppob-attention"

/**
 * The count of PPOB lines that still wait on an answer, next to "Riwayat" in
 * the sidebar. Nothing at zero. On the collapsed rail the label is hidden, so
 * the count shrinks to a dot on the icon; the link's tooltip still names the
 * page, and the screen-reader text names the count.
 */
export function PpobAttentionBadge() {
  const count = usePpobAttention()
  if (count === 0) return null

  const label = id.transactions.ppobAttentionCount(count)
  return (
    <>
      <span className="sr-only">{label}</span>
      <Chip
        aria-hidden="true"
        className="ms-auto shrink-0 tabular-nums group-data-[state=collapsed]/sidebar:hidden"
        color="warning"
        size="sm"
        title={label}
        variant="soft"
      >
        {count > 99 ? "99+" : count}
      </Chip>
      <span
        aria-hidden="true"
        className="absolute top-1.5 left-6 hidden size-2 rounded-full bg-warning group-data-[state=collapsed]/sidebar:block"
      />
    </>
  )
}
