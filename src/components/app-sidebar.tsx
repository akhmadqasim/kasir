import * as React from "react"
import { NavLink } from "react-router-dom"
import {
  ShoppingCartIcon,
  PackageIcon,
  HistoryIcon,
  FileWarningIcon,
  BarChart3Icon,
  SettingsIcon,
  UsersIcon,
  StoreIcon,
  RotateCcwIcon,
  LayoutDashboardIcon,
  Building2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { id } from "@/i18n/id"
import { isAdminOnlyRoute } from "@/app/resume-route"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

const navMain = [
  {
    title: id.dashboard.title,
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: id.nav.cashier,
    url: "/cashier",
    icon: <ShoppingCartIcon />,
  },
  {
    title: id.nav.products,
    url: "/products",
    icon: <PackageIcon />,
  },
  {
    title: id.nav.transactions,
    url: "/transactions",
    icon: <HistoryIcon />,
  },
  {
    title: id.nav.refunds,
    url: "/refunds",
    icon: <RotateCcwIcon />,
  },
  {
    title: id.nav.stock,
    url: "/stock",
    icon: <FileWarningIcon />,
  },
  {
    title: id.nav.reports,
    url: "/reports",
    icon: <BarChart3Icon />,
    items: [
      { group: "Penjualan", title: "Per Hari", url: "/reports/sales-daily" },
      { group: "Penjualan", title: "Per Bulan", url: "/reports/sales-monthly" },
      { group: "Penjualan", title: "Per Periode", url: "/reports/sales-period" },
      { group: "Penjualan", title: "Per Struk", url: "/reports/sales-receipt" },
      { group: "Penjualan", title: "Jenis Pembayaran", url: "/reports/payment-methods" },
      { group: "Kas", title: "Uang Masuk / Keluar", url: "/reports/cash-flows" },
      { group: "Produk", title: "Penjualan Produk", url: "/reports/product-sales" },
      { group: "Produk", title: "Produk Populer", url: "/reports/popular-products" },
      { group: "Produk", title: "Retur Produk", url: "/reports/returns" },
      { group: "Stok", title: "Stok Saat Ini", url: "/reports/current-stock" },
      { group: "Stok", title: "Laporan Kerugian", url: "/reports/losses" },
    ],
  },
  {
    title: id.nav.ppob,
    url: "/ppob",
    icon: <Building2Icon />,
  },
  {
    title: id.nav.settings,
    url: "/settings",
    icon: <SettingsIcon />,
  },
]

const navAdmin = [
  {
    title: id.nav.users,
    url: "/users",
    icon: <UsersIcon />,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const { toggleSidebar, open, hoverExpanded, pinSidebar } = useSidebar()

  // Keep the menu in step with AdminRouteGuard: a cashier should not see an entry
  // that redirects them straight back out.
  const visibleNavMain = isAdmin
    ? navMain
    : navMain.filter((item) => !isAdminOnlyRoute(item.url))

  const handleToggleClick = () => {
    if (hoverExpanded) {
      pinSidebar()
    } else {
      toggleSidebar()
    }
  }

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <StoreIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{id.app.name}</span>
                  <span className="truncate text-xs">Point of Sale</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
            {open && (
              <button
                onClick={handleToggleClick}
                className="absolute right-2 top-3 flex size-7 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                title={hoverExpanded ? "Sematkan sidebar" : "Kecilkan sidebar"}
              >
                {hoverExpanded ? <PanelLeftOpenIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
              </button>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={visibleNavMain} />
        {isAdmin && (
          <NavSecondary items={navAdmin} className="mt-auto" />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
