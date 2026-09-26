import { useMemo } from "react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import type { PpSubMenuItem } from "../../types"
import { PaymentPointIcon } from "../payment-point-icon"
import { TileButton } from "../tile-button"
import { TileGrid, TileGridSkeleton } from "../tile-grid"
import { PpobSetupAction } from "../ppob-setup-action"

interface PpMerchantStepProps {
  merchants: PpSubMenuItem[] | undefined
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  /** `true` selama permintaan ulang berjalan. */
  isRetrying?: boolean
  search: string
  onSearchChange: (value: string) => void
  onSelect: (merchant: PpSubMenuItem) => void
}

/** Langkah 2 Payment Point: cari dan pilih biller dalam satu kategori. */
export function PpMerchantStep({
  merchants,
  isLoading,
  error,
  onRetry,
  isRetrying = false,
  search,
  onSearchChange,
  onSelect,
}: PpMerchantStepProps) {
  const filtered = useMemo(() => {
    if (!merchants) return []
    if (!search) return merchants
    const q = search.toLowerCase()
    return merchants.filter(
      (item) =>
        item.merchant.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    )
  }, [merchants, search])

  return (
    <>
      <SearchInput
        aria-label={id.ppob.searchMerchant}
        className="max-w-sm"
        placeholder={id.ppob.searchMerchant}
        value={search}
        onChange={onSearchChange}
      />

      {isLoading ? (
        <TileGridSkeleton count={6} />
      ) : error ? (
        <LoadError
          isRetrying={isRetrying}
          secondaryAction={<PpobSetupAction error={error} />}
          title={id.loadFailed.ppobMerchants}
          onRetry={onRetry}
        >
          {error.message}
        </LoadError>
      ) : filtered.length === 0 ? (
        <NoData title={id.ppob.merchantNotFound} />
      ) : (
        // Merchant yang bermasalah tetap terlihat, ditandai `StatusBadge`
        // "Gangguan" di bawah namanya, tapi ubinnya tidak bisa ditekan.
        <TileGrid>
          {filtered.map((item) => (
            <TileButton
              key={item.id}
              badge={
                item.isTrouble ? (
                  <StatusBadge size="sm" status="warning">
                    {id.ppob.trouble}
                  </StatusBadge>
                ) : undefined
              }
              description={item.isTrouble ? undefined : item.description || undefined}
              icon={<PaymentPointIcon className="size-8" pathIcon={item.pathIcon} />}
              isDisabled={!!item.isTrouble}
              label={item.merchant}
              onPress={() => onSelect(item)}
            />
          ))}
        </TileGrid>
      )}
    </>
  )
}
