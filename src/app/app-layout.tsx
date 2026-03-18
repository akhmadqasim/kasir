import { useEffect } from "react"
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { toast } from "sonner"
import {
  ShoppingCart,
  Package,
  History,
  FileWarning,
  BarChart3,
  Settings,
  Users,
  LogOut,
  Store,
  ChevronsUpDown,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { LucideIcon } from "lucide-react"

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
}

const mainNavItems: NavItem[] = [
  { to: "/cashier", icon: ShoppingCart, label: id.nav.cashier },
  { to: "/products", icon: Package, label: id.nav.products },
  { to: "/transactions", icon: History, label: id.nav.transactions },
  { to: "/stock", icon: FileWarning, label: id.nav.stock },
  { to: "/reports", icon: BarChart3, label: id.nav.reports },
]

const adminNavItems: NavItem[] = [
  { to: "/settings", icon: Settings, label: id.nav.settings },
  { to: "/users", icon: Users, label: id.nav.users },
]

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function AppSidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = user?.role === "admin"

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/cashier">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Store className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{id.app.name}</span>
                  <span className="truncate text-xs">Point of Sale</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarMenu>
            {mainNavItems.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.label}
                  isActive={location.pathname === item.to}
                >
                  <NavLink to={item.to}>
                    <item.icon />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              {adminNavItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    isActive={location.pathname === item.to}
                  >
                    <NavLink to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {user?.full_name ? getInitials(user.full_name) : "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user?.full_name}</span>
                    <span className="truncate text-xs capitalize">{user?.role}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="right"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg">
                        {user?.full_name ? getInitials(user.full_name) : "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{user?.full_name}</span>
                      <span className="truncate text-xs capitalize">{user?.role}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut />
                  {id.auth.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

export function AppLayout() {
  const updateActivity = useAuthStore((s) => s.updateActivity)
  const checkTimeout = useAuthStore((s) => s.checkTimeout)
  const navigate = useNavigate()

  // Session timeout check
  useEffect(() => {
    const interval = setInterval(() => {
      if (checkTimeout()) {
        toast.error(id.auth.sessionExpired)
        navigate("/login")
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [checkTimeout, navigate])

  // Track user activity
  useEffect(() => {
    const handler = () => updateActivity()
    document.addEventListener("click", handler)
    document.addEventListener("keypress", handler)
    return () => {
      document.removeEventListener("click", handler)
      document.removeEventListener("keypress", handler)
    }
  }, [updateActivity])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-muted-foreground">
            {id.app.name}
          </span>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
