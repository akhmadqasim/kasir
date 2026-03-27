import { useAuthStore } from "@/features/auth"
import { id } from "@/i18n/id"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Store,
  ShoppingCart,
  Printer,
  Database,
  Zap,
} from "lucide-react"
import { StoreInfoTab } from "./store-info-tab"
import { SalesSettingsTab } from "./sales-settings-tab"
import { PrinterSettingsTab } from "./printer-settings-tab"
import { DataTab } from "./data-tab"
import { PpobSettingsTab } from "./ppob-settings-tab"

export function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">{id.settings.title}</h1>
      <Tabs defaultValue="store" className="space-y-4">
        <TabsList>
          <TabsTrigger value="store">
            <Store className="h-4 w-4 mr-2" />
            {id.settings.tabStore}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="sales">
              <ShoppingCart className="h-4 w-4 mr-2" />
              {id.settings.tabSales}
            </TabsTrigger>
          )}
          <TabsTrigger value="printer">
            <Printer className="h-4 w-4 mr-2" />
            {id.settings.tabPrinter}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="data">
              <Database className="h-4 w-4 mr-2" />
              {id.settings.tabData}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="ppob">
              <Zap className="h-4 w-4 mr-2" />
              {id.settings.tabPpob}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="store">
          <StoreInfoTab isAdmin={isAdmin} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="sales">
            <SalesSettingsTab />
          </TabsContent>
        )}
        <TabsContent value="printer">
          <PrinterSettingsTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="data">
            <DataTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="ppob">
            <PpobSettingsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
