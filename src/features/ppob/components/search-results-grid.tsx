import { Skeleton } from "@heroui/react"

import { NoData } from "@/components/no-data"
import { cn } from "@/lib/utils"
import { id } from "@/i18n/id"
import { PPOB_SERVICE_COLORS, PPOB_SERVICES, type PpobServiceDef } from "../constants"
import type { PpSearchResult } from "../types"
import { PaymentPointIcon } from "./payment-point-icon"
import { TileButton } from "./tile-button"
import { TileGrid } from "./tile-grid"

interface SearchResultsGridProps {
  /** The raw (non-debounced) search box value — matched against fixed service labels instantly. */
  query: string
  /** `undefined` while the debounced biller search has not answered yet. */
  billers: PpSearchResult[] | undefined
  isLoading: boolean
  onSelectService: (service: PpobServiceDef) => void
  onSelectBiller: (item: PpSearchResult) => void
}

/**
 * The service kisi in search mode: the fixed tiles (Pulsa, PLN, ...) whose
 * label matches `query`, plus every payment-point biller the server found —
 * both drawn as the same `TileButton` the default kisi uses (`ppob-home.tsx`
 * swaps this in for `ServiceGrid` for as long as there is a query), so a
 * result never looks like a different kind of thing than a service tile.
 */
export function SearchResultsGrid({
  query,
  billers,
  isLoading,
  onSelectService,
  onSelectBiller,
}: SearchResultsGridProps) {
  const q = query.trim().toLowerCase()
  const matchingServices = PPOB_SERVICES.filter((service) =>
    service.label.toLowerCase().includes(q),
  )

  // The fixed-tile match is instant; only the biller half waits on the
  // debounced request. Loading skeletons only while that half has never
  // answered at all — a keystroke that narrows an already-loaded list must
  // not flash the whole kisi back to loading.
  if (isLoading && billers === undefined) {
    return (
      <TileGrid>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </TileGrid>
    )
  }

  if (matchingServices.length === 0 && (billers?.length ?? 0) === 0) {
    return <NoData title={id.ppob.searchNoResults(query)} />
  }

  return (
    <TileGrid>
      {matchingServices.map((service) => (
        <TileButton
          key={service.key}
          icon={<service.icon className={cn("size-6", PPOB_SERVICE_COLORS[service.key].text)} />}
          label={service.label}
          onPress={() => onSelectService(service)}
        />
      ))}
      {billers?.map((item) => (
        <TileButton
          key={`biller-${item.id}`}
          description={item.group.name}
          icon={<PaymentPointIcon className="size-6" pathIcon={item.pathIcon} />}
          label={item.merchant}
          onPress={() => onSelectBiller(item)}
        />
      ))}
    </TileGrid>
  )
}
