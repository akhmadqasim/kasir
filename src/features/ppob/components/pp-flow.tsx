import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePpobMenu, usePpSubMenu } from "../hooks"
import type { PpobMenuGroup, PpSubMenuItem } from "../types"

export function PpFlow() {
  const navigate = useNavigate()
  const [selectedGroup, setSelectedGroup] = useState<PpobMenuGroup | null>(null)
  const [selectedMerchant, setSelectedMerchant] = useState<PpSubMenuItem | null>(null)
  const [merchantSearch, setMerchantSearch] = useState("")
  const [paymentCode, setPaymentCode] = useState("")

  const { data: groups, isLoading: groupsLoading } = usePpobMenu()
  const { data: subMenuItems, isLoading: subMenuLoading } = usePpSubMenu(
    selectedGroup?.id ?? 0
  )

  const filteredMerchants = useMemo(() => {
    if (!subMenuItems) return []
    if (!merchantSearch) return subMenuItems
    const q = merchantSearch.toLowerCase()
    return subMenuItems.filter(
      (item) =>
        item.merchant.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    )
  }, [subMenuItems, merchantSearch])

  const handleBack = () => {
    if (selectedMerchant) {
      setSelectedMerchant(null)
      setPaymentCode("")
    } else if (selectedGroup) {
      setSelectedGroup(null)
      setMerchantSearch("")
    } else {
      navigate("/ppob")
    }
  }

  const currentTitle = selectedMerchant
    ? selectedMerchant.merchant
    : selectedGroup
      ? selectedGroup.group
      : id.ppob.pp

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{currentTitle}</h1>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* Step 1: Group Selection */}
          {!selectedGroup && (
            <>
              {groupsLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {groups?.map((group) => (
                    <Card
                      key={group.id}
                      className="cursor-pointer transition-colors hover:bg-accent"
                      onClick={() => setSelectedGroup(group)}
                    >
                      <CardContent className="flex flex-col items-center gap-2 py-6">
                        {group.pathIcon && (
                          <img src={group.pathIcon} alt={group.group} className="h-8 w-8" />
                        )}
                        <span className="text-sm font-medium text-center">
                          {group.group}
                        </span>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Step 2: Merchant Selection */}
          {selectedGroup && !selectedMerchant && (
            <>
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={id.ppob.searchMerchant}
                  value={merchantSearch}
                  onChange={(e) => setMerchantSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {subMenuLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {filteredMerchants.map((item) => (
                    <Card
                      key={item.id}
                      className={`cursor-pointer transition-colors hover:bg-accent ${
                        item.isTrouble ? "opacity-50" : ""
                      }`}
                      onClick={() => {
                        if (!item.isTrouble) setSelectedMerchant(item)
                      }}
                    >
                      <CardContent className="py-4 flex items-center gap-3">
                        {item.pathIcon && (
                          <img src={item.pathIcon} alt={item.merchant} className="h-8 w-8" />
                        )}
                        <div>
                          <p className="font-medium">{item.merchant}</p>
                          {item.description && (
                            <p className="text-sm text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                          {item.label && (
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Step 3: Payment Code Input */}
          {selectedMerchant && (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedMerchant.merchant}</p>
                    {selectedMerchant.description && (
                      <p className="text-sm text-muted-foreground">
                        {selectedMerchant.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{id.ppob.paymentCode}</Label>
                  <Input
                    type="text"
                    placeholder={id.ppob.paymentCodePlaceholder}
                    value={paymentCode}
                    onChange={(e) => setPaymentCode(e.target.value)}
                    className="font-mono text-xl md:text-xl h-12"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedMerchant && paymentCode.length >= 6 ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.selectGroup}</span>
                    <span className="font-medium">{selectedGroup?.group}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.selectMerchant}</span>
                    <span className="font-medium">{selectedMerchant.merchant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.paymentCode}</span>
                    <span className="font-mono text-base font-medium">{paymentCode}</span>
                  </div>
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : groups ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
