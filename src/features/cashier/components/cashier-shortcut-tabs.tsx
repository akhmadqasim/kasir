import { ScrollShadow, Skeleton, Tabs } from "@heroui/react"
import { TrendingUp } from "lucide-react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { useApiQuery } from "@/hooks/use-api"
import { getPopularProducts } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import type { ShortcutProduct } from "@/features/products/types"
import { PpobQuickAccess } from "@/features/ppob"
import { id } from "@/i18n/id"
import { ShortcutTile } from "./shortcut-tile"

/** How many shortcut tiles the cashier screen asks for. */
const SHORTCUT_LIMIT = 30

interface CashierShortcutTabsProps {
  /** Must be stable: every `ShortcutTile` is memoised on it. */
  onSelectProduct: (product: ShortcutProduct) => void
}

/**
 * What the product panel shows while nothing is being searched: the Favorit
 * tiles and the PPOB quick access. Tabnya sudah di panel produk, jadi kata
 * "Produk" tidak diulang di labelnya; tanpa ikon, seperti tab dashboard.
 */
export function CashierShortcutTabs({ onSelectProduct }: CashierShortcutTabsProps) {
  const {
    data: shortcutProducts,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useApiQuery<ShortcutProduct[]>(queryKeys.products.popular(SHORTCUT_LIMIT), () =>
    getPopularProducts(SHORTCUT_LIMIT),
  )

  return (
    <Tabs className="min-h-0 flex-1" defaultSelectedKey="produk">
      <Tabs.ListContainer className="mx-4 w-fit">
        <Tabs.List aria-label="Pintasan kasir">
          <Tabs.Tab id="produk">
            Favorit
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="ppob">
            PPOB
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>

      {/* Panel mengisi sisa tinggi dan menggulung sendiri; jarak dan
          padding-nya diambil dari `p-4` di dalam supaya sama dengan kepala
          panel, bukan `mt-4 p-2` bawaan yang menambah 24px. */}
      <Tabs.Panel className="mt-0 min-h-0 flex-1 p-0" id="produk">
        <ScrollShadow className="h-full">
          <div className="p-4">
            {isPending ? (
              <div
                aria-hidden="true"
                className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3"
              >
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : isError ? (
              <LoadError
                title={id.loadFailed.favoriteProducts}
                isRetrying={isFetching}
                onRetry={() => refetch()}
              >
                {error?.message}
              </LoadError>
            ) : shortcutProducts && shortcutProducts.length > 0 ? (
              // Kolomnya dihitung dari lebar panel, bukan dari breakpoint
              // viewport: panel ini selebar sepertiga layar, jadi `lg:` yang
              // menyala di layar 1400px memecahnya jadi empat kolom 91px dan
              // setiap nama terpotong setelah tujuh huruf. `auto-fill` dengan
              // lebar minimum menjamin ubin selalu cukup lebar untuk dibaca.
              // `auto-rows-fr` menyamakan tingginya.
              <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
                {shortcutProducts.map((product) => (
                  <ShortcutTile key={product.id} product={product} onSelect={onSelectProduct} />
                ))}
              </div>
            ) : (
              <NoData icon={<TrendingUp />} title={id.empty.favoriteProducts}>
                {id.empty.favoriteProductsHint}
              </NoData>
            )}
          </div>
        </ScrollShadow>
      </Tabs.Panel>

      {/* Padding luar milik panel ini, bukan `PpobQuickAccess`: di halaman
          PPOB komponen yang sama berdiri langsung di atas kanvas yang sudah
          diberi padding `AppLayout`. */}
      <Tabs.Panel className="mt-0 min-h-0 flex-1 p-0" id="ppob">
        <ScrollShadow className="h-full">
          <div className="p-4">
            <PpobQuickAccess />
          </div>
        </ScrollShadow>
      </Tabs.Panel>
    </Tabs>
  )
}
