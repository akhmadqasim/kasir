import { useNavigate } from "react-router-dom"
import { LayoutDashboardIcon, PackageIcon, ShoppingCartIcon, HistoryIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { id } from "@/i18n/id"

export function StartPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const primaryPath = user?.role === "kasir" ? "/cashier" : "/transactions"
  const primaryLabel = user?.role === "kasir" ? id.nav.cashier : id.nav.transactions
  const PrimaryIcon = user?.role === "kasir" ? ShoppingCartIcon : HistoryIcon

  return (
    <div className="flex h-full flex-col">
      <Empty className="border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboardIcon />
          </EmptyMedia>
          <EmptyTitle>Selamat datang di {id.app.name}</EmptyTitle>
          <EmptyDescription>
            App shell sudah siap. Pilih area kerja yang ingin dibuka tanpa memaksa
            dashboard memuat saat startup.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="sm:max-w-md">
          <Button className="w-full" onClick={() => navigate(primaryPath)}>
            <PrimaryIcon className="mr-2 h-4 w-4" />
            Buka {primaryLabel}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/dashboard")}>
            <LayoutDashboardIcon className="mr-2 h-4 w-4" />
            Buka {id.dashboard.title}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/products")}>
            <PackageIcon className="mr-2 h-4 w-4" />
            Buka {id.nav.products}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
