import type { ReactNode } from "react"
import {
  BarChart3Icon,
  Building2Icon,
  FileWarningIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  PackageIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShoppingCartIcon,
  UsersIcon,
} from "lucide-react"

import { id } from "@/i18n/id"
import { isPathWithin } from "./resume-route"

export interface NavSubItem {
  group?: string
  title: string
  url: string
}

export interface NavItem {
  title: string
  url: string
  icon: ReactNode
  items?: NavSubItem[]
}

/**
 * Satu daftar navigasi untuk sidebar dan navbar.
 *
 * Dulu tinggal di `app-sidebar.tsx`. Sejak navbar menampilkan judul halaman
 * yang sedang dibuka, daftar ini dibaca dari dua tempat, dan menyalinnya
 * berarti judul di atas halaman bisa berbeda dari label menu yang membukanya.
 */
export const NAV_MAIN: NavItem[] = [
  { title: id.dashboard.title, url: "/dashboard", icon: <LayoutDashboardIcon /> },
  { title: id.nav.cashier, url: "/cashier", icon: <ShoppingCartIcon /> },
  { title: id.nav.products, url: "/products", icon: <PackageIcon /> },
  { title: id.nav.transactions, url: "/transactions", icon: <HistoryIcon /> },
  { title: id.nav.refunds, url: "/refunds", icon: <RotateCcwIcon /> },
  { title: id.nav.stock, url: "/stock", icon: <FileWarningIcon /> },
  {
    title: id.nav.reports,
    url: "/reports",
    icon: <BarChart3Icon />,
    items: [
      {
        group: id.reports.group.sales,
        title: id.reports.nav.salesDaily,
        url: "/reports/sales-daily",
      },
      {
        group: id.reports.group.sales,
        title: id.reports.nav.salesMonthly,
        url: "/reports/sales-monthly",
      },
      {
        group: id.reports.group.sales,
        title: id.reports.nav.salesPeriod,
        url: "/reports/sales-period",
      },
      {
        group: id.reports.group.sales,
        title: id.reports.nav.salesReceipt,
        url: "/reports/sales-receipt",
      },
      {
        group: id.reports.group.sales,
        title: id.reports.title.paymentMethods,
        url: "/reports/payment-methods",
      },
      {
        group: id.reports.group.cash,
        title: id.reports.title.cashFlows,
        url: "/reports/cash-flows",
      },
      {
        group: id.reports.group.products,
        title: id.reports.title.productSales,
        url: "/reports/product-sales",
      },
      {
        group: id.reports.group.products,
        title: id.reports.title.popularProducts,
        url: "/reports/popular-products",
      },
      {
        group: id.reports.group.products,
        title: id.reports.title.returns,
        url: "/reports/returns",
      },
      {
        group: id.reports.group.stock,
        title: id.reports.title.currentStock,
        url: "/reports/current-stock",
      },
      { group: id.reports.group.stock, title: id.reports.title.losses, url: "/reports/losses" },
    ],
  },
  { title: id.nav.ppob, url: "/ppob", icon: <Building2Icon /> },
  { title: id.nav.settings, url: "/settings", icon: <SettingsIcon /> },
]

export const NAV_ADMIN: NavItem[] = [{ title: id.nav.users, url: "/users", icon: <UsersIcon /> }]

/**
 * Judul halaman untuk sebuah path, dari item navigasi yang paling spesifik.
 *
 * Sub-item dicek lebih dulu supaya `/reports/sales-daily` berjudul "Per Hari",
 * bukan "Laporan". Path yang tidak ada di menu mengembalikan `undefined`, dan
 * navbar lalu tidak menampilkan judul apa pun — lebih jujur daripada menebak.
 */
export function pageTitleFor(pathname: string): string | undefined {
  for (const item of ALL_NAV_ITEMS) {
    const sub = item.items?.find((entry) => entry.url === pathname)
    if (sub) return sub.title
  }
  return ALL_NAV_ITEMS.find((item) => isPathWithin(pathname, item.url))?.title
}

const ALL_NAV_ITEMS = [...NAV_MAIN, ...NAV_ADMIN]
