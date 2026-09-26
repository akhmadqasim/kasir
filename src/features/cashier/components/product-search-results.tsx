import { Skeleton } from "@heroui/react"
import { PackageSearch } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Product } from "@/features/products/types"
import { id } from "@/i18n/id"
import { searchOptionId } from "../search-behavior"
import { formatRupiah } from "../utils"

interface ProductSearchResultsProps {
  listboxId: string
  products: Product[]
  /** The row Enter would add; `String(product.id)`. */
  activeValue: string | undefined
  isLoading: boolean
  isError: boolean
  errorMessage: string | undefined
  onRetry: () => void
  /** `true` selama pencarian ulang berjalan. */
  isRetrying?: boolean
  onSelect: (product: Product) => void
}

/**
 * The listbox under the scan field. It never takes focus: the field points at
 * the active row through `aria-activedescendant` — see `ProductSearchPanel`.
 */
export function ProductSearchResults({
  listboxId,
  products,
  activeValue,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isRetrying = false,
  onSelect,
}: ProductSearchResultsProps) {
  if (products.length > 0) {
    return (
      <ul aria-label="Hasil pencarian produk" className="p-2" id={listboxId} role="listbox">
        {products.map((product) => {
          const isActive = String(product.id) === activeValue
          return (
            // Bentuk barisnya mengikuti `.list-box-item` HeroUI — sudut
            // `rounded-2xl`, hover `bg-default` — karena inilah listbox-nya.
            <li
              key={product.id}
              aria-selected={isActive}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-sm",
                isActive ? "bg-default text-default-foreground" : "hover:bg-default/60",
              )}
              id={searchOptionId(listboxId, product.id)}
              role="option"
              onPointerDown={(e) => {
                // Jangan sampai kolom scan kehilangan fokus sebelum
                // produknya masuk keranjang.
                e.preventDefault()
                onSelect(product)
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{product.name}</p>
                {product.barcode && (
                  <p className="font-mono text-xs text-muted">{product.barcode}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Lencana hanya untuk stok habis; stok yang ada cuma angka — DESIGN.md §5.4. */}
                {product.stock <= 0 ? (
                  <StatusBadge className="tabular-nums" size="sm" status="error">
                    {product.stock < 0
                      ? `Stok ${formatNumber(product.stock)} ${product.unit}`
                      : "Habis"}
                  </StatusBadge>
                ) : (
                  <span className="text-xs tabular-nums text-muted">
                    {formatNumber(product.stock)} {product.unit}
                  </span>
                )}
                <span className="min-w-20 text-right font-medium tabular-nums">
                  {formatRupiah(product.sell_price)}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  if (isLoading) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-1 p-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-3/5 rounded-md" />
              <Skeleton className="h-3 w-1/4 rounded-md" />
            </div>
            <Skeleton className="h-4 w-20 rounded-md" />
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <LoadError isRetrying={isRetrying} title={id.products.searchFailed} onRetry={onRetry}>
        {errorMessage}
      </LoadError>
    )
  }

  return (
    <NoData icon={<PackageSearch />} title={id.products.notFound}>
      Periksa ejaannya, atau cari dengan barcode / SKU.
    </NoData>
  )
}
