import { NAV_ADMIN, NAV_MAIN } from "@/app/navigation"
import { isAdminOnlyRoute } from "@/app/resume-route"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { StoreLogo } from "@/components/store-logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
} from "@/components/layout/sidebar"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useStoreInfo } from "@/features/settings"

/**
 * Sidebar aplikasi: merek di kepala, menu di tengah, pengguna di kaki.
 *
 * Tombol lipatnya tidak lagi di sini — ia duduk di navbar halaman, seperti di
 * template dashboard HeroUI Pro. Daftar menunya dibaca dari `app/navigation`,
 * sumber yang sama yang dipakai navbar untuk menurunkan judul halaman.
 */
export function AppSidebar() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const store = useStoreInfo().data

  // Keep the menu in step with AdminRouteGuard: a cashier should not see an entry
  // that redirects them straight back out.
  const visibleNavMain = isAdmin ? NAV_MAIN : NAV_MAIN.filter((item) => !isAdminOnlyRoute(item.url))

  return (
    <Sidebar label="Menu utama">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Baris merek meniru kepala sidebar template HeroUI Pro: Avatar 36px
                lalu dua baris teks, nama `text-sm font-medium` dan keterangan
                `text-xs font-medium text-muted`. Avatarnya logo toko yang
                diunggah di Pengaturan, atau ikon bawaan bila belum ada. */}
            <SidebarMenuLink to="/dashboard" size="lg" tooltip={id.app.name}>
              <StoreLogo store={store} className="size-9 shrink-0" />
              <SidebarLabel className="grid leading-tight">
                <span className="truncate text-sm font-medium">{id.app.name}</span>
                <span className="truncate text-xs font-medium text-muted">Point of Sale</span>
              </SidebarLabel>
            </SidebarMenuLink>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={visibleNavMain} />
        {isAdmin && <NavSecondary items={NAV_ADMIN} className="mt-auto" />}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
