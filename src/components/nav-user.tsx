import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Avatar, Dropdown, Label, Separator } from "@heroui/react"
import { ChevronsUpDownIcon, LogOutIcon, UserIcon } from "lucide-react"

import { SidebarLabel, SidebarMenu, SidebarMenuItem } from "@/components/layout/sidebar"
import { sidebarMenuButtonClass, useSidebar } from "@/components/layout/sidebar-context"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useLogout } from "@/features/auth/hooks/use-auth"
import { useCartStore } from "@/features/cashier/hooks/use-cart-store"
import { useShiftStore } from "@/features/shift/hooks/use-shift-store"
import { UserProfileDialog } from "@/features/users/components/user-profile-dialog"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function NavUser() {
  const { isMobile } = useSidebar()
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  const initials = user?.full_name ? getInitials(user.full_name) : "U"

  const handleLogout = () => {
    // The server drops the session row and clears the cookie; the mutation drops
    // the cached user and the whole query cache with it. Everything below is
    // state that lives outside React Query and would otherwise be inherited by
    // whoever logs in next on this till.
    logout.mutate(undefined, {
      onSettled: () => {
        useShiftStore.getState().clearShift()
        // The cart is persisted to localStorage, so without this the next
        // cashier inherits these items and rings them up as their own.
        useCartStore.getState().clear()
        navigate("/login")
      },
    })
  }

  const handleAction = (key: React.Key) => {
    if (key === "profile") {
      setProfileOpen(true)
    } else if (key === "logout") {
      handleLogout()
    }
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <Dropdown>
            <Dropdown.Trigger
              aria-label={id.profile.title}
              className={sidebarMenuButtonClass(
                "lg",
                "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
              )}
            >
              <Avatar size="sm" className="rounded-lg">
                <Avatar.Fallback className="rounded-lg">{initials}</Avatar.Fallback>
              </Avatar>
              <SidebarLabel className="grid leading-tight">
                <span className="truncate text-sm font-medium">{user?.full_name}</span>
                <span className="truncate text-xs capitalize">{user?.role}</span>
              </SidebarLabel>
              <ChevronsUpDownIcon className="ml-auto group-data-[state=collapsed]/sidebar:hidden" />
            </Dropdown.Trigger>
            <Dropdown.Popover
              className="min-w-56"
              placement={isMobile ? "bottom end" : "right bottom"}
            >
              <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                <Avatar size="sm" className="rounded-lg">
                  <Avatar.Fallback className="rounded-lg">{initials}</Avatar.Fallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">{user?.full_name}</span>
                  <span className="truncate text-xs capitalize text-muted">{user?.role}</span>
                </div>
              </div>
              <Separator className="my-1" />
              <Dropdown.Menu onAction={handleAction}>
                <Dropdown.Item id="profile" textValue={id.profile.title}>
                  <UserIcon className="size-4" />
                  <Label>{id.profile.title}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="logout" textValue={id.auth.logout}>
                  <LogOutIcon className="size-4" />
                  <Label>{id.auth.logout}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </SidebarMenuItem>
      </SidebarMenu>

      <UserProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  )
}
