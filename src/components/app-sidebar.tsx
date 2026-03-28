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
} from "@/components/ui/sidebar"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"

const navMain = [
  {
    title: id.nav.cashier,
    url: "/cashier",
    icon: <ShoppingCartIcon />,
  },
  {
    title: id.dashboard.title,
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
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

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/cashier">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <StoreIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{id.app.name}</span>
                  <span className="truncate text-xs">Point of Sale</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
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
