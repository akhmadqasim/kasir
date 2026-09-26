import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Avatar, Dropdown, Label } from "@heroui/react"
import { ChevronsUpDownIcon, LogOutIcon, UserIcon } from "lucide-react"

import { SidebarLabel, SidebarMenu, SidebarMenuItem } from "@/components/layout/sidebar"
import { sidebarMenuButtonClass, useSidebar } from "@/components/layout/sidebar-context"
import { id } from "@/i18n/id"
import { useAuthStore, useLogout } from "@/features/auth"
import { roleLabel as labelForRole } from "@/lib/labels"
// Deep on purpose: the users barrel exports the lazy-loaded `UsersPage`, and
// this menu is in the main chunk (DESIGN.md §8, rule 4).
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
  const roleLabel = user ? labelForRole(user.role) : ""

  const handleLogout = () => {
    // The server drops the session row and clears the cookie; `useLogout`
    // itself drops the cached user, the query cache, the shift and the cart,
    // so no logout path can skip them. All that is left here is where to go.
    logout.mutate(undefined, { onSettled: () => navigate("/login") })
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
              aria-label={
                user?.full_name ? `${id.profile.title}: ${user.full_name}` : id.profile.title
              }
              className={sidebarMenuButtonClass(
                "lg",
                "aria-expanded:bg-default aria-expanded:text-default-foreground",
              )}
            >
              <Avatar size="sm">
                <Avatar.Fallback>{initials}</Avatar.Fallback>
              </Avatar>
              <SidebarLabel className="grid leading-tight">
                <span className="truncate text-sm font-medium">{user?.full_name}</span>
                <span className="truncate text-xs text-muted">{roleLabel}</span>
              </SidebarLabel>
              <ChevronsUpDownIcon className="ml-auto group-data-[state=collapsed]/sidebar:hidden" />
            </Dropdown.Trigger>
            <Dropdown.Popover
              className="min-w-56"
              placement={isMobile ? "bottom end" : "right bottom"}
            >
              {/* Kepala menu mengikuti contoh "Custom Trigger" di dokumentasi
                  Dropdown: avatar kecil dan dua baris teks, tanpa pemisah ke
                  menunya — jarak yang memisahkan, bukan garis. */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <Avatar size="sm">
                    <Avatar.Fallback>{initials}</Avatar.Fallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate text-sm leading-5 font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs leading-none text-muted">{roleLabel}</p>
                  </div>
                </div>
              </div>
              <Dropdown.Menu onAction={handleAction}>
                <Dropdown.Item id="profile" textValue={id.profile.title}>
                  <UserIcon className="size-4 shrink-0 text-muted" />
                  <Label>{id.profile.title}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="logout" textValue={id.auth.logout} variant="danger">
                  <LogOutIcon className="size-4 shrink-0 text-danger" />
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
