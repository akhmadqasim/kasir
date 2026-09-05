import type { ReactNode } from "react"
import { Tabs } from "@heroui/react"
import { Store, ShoppingCart, Printer, Database, Zap } from "lucide-react"

import { useAuthStore } from "@/features/auth"
import { id } from "@/i18n/id"
import { StoreInfoTab } from "./store-info-tab"
import { SalesSettingsTab } from "./sales-settings-tab"
import { PrinterSettingsTab } from "./printer-settings-tab"
import { DataTab } from "./data-tab"
import { PpobSettingsTab } from "./ppob-settings-tab"

interface SettingsTab {
  key: string
  label: string
  icon: ReactNode
  panel: ReactNode
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"

  // React Aria pairs a tab with its panel by `id`, so both come from one list here
  // instead of two parallel `isAdmin && ...` blocks: a kasir can never end up with a
  // panel whose tab was filtered out (or the reverse), and the order stays fixed.
  const tabs: SettingsTab[] = [
    {
      key: "store",
      label: id.settings.tabStore,
      icon: <Store className="mr-2 h-4 w-4" />,
      panel: <StoreInfoTab isAdmin={isAdmin} />,
    },
    ...(isAdmin
      ? [
          {
            key: "sales",
            label: id.settings.tabSales,
            icon: <ShoppingCart className="mr-2 h-4 w-4" />,
            panel: <SalesSettingsTab />,
          },
        ]
      : []),
    {
      key: "printer",
      label: id.settings.tabPrinter,
      icon: <Printer className="mr-2 h-4 w-4" />,
      panel: <PrinterSettingsTab />,
    },
    ...(isAdmin
      ? [
          {
            key: "data",
            label: id.settings.tabData,
            icon: <Database className="mr-2 h-4 w-4" />,
            panel: <DataTab />,
          },
          {
            key: "ppob",
            label: id.settings.tabPpob,
            icon: <Zap className="mr-2 h-4 w-4" />,
            panel: <PpobSettingsTab />,
          },
        ]
      : []),
  ]

  return (
    <div className="max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">{id.settings.title}</h1>
      <Tabs defaultSelectedKey="store">
        <Tabs.ListContainer>
          <Tabs.List aria-label={id.settings.title}>
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.key} id={tab.key}>
                {tab.icon}
                {tab.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.key} className="pt-4" id={tab.key}>
            {tab.panel}
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  )
}
