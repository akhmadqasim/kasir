import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card, Input, Label, SearchField, Skeleton, TextField } from "@heroui/react"
import { ArrowLeft } from "lucide-react"

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
        <Button aria-label={id.common.back} isIconOnly variant="ghost" onPress={handleBack}>
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
                    <Button
                      key={group.id}
                      className="h-auto flex-col gap-2 py-6"
                      variant="outline"
                      onPress={() => setSelectedGroup(group)}
                    >
                      {group.pathIcon && (
                        <img src={group.pathIcon} alt={group.group} className="h-8 w-8" />
                      )}
                      <span className="text-center text-sm font-medium">{group.group}</span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Step 2: Merchant Selection */}
          {selectedGroup && !selectedMerchant && (
            <>
              <SearchField
                aria-label={id.ppob.searchMerchant}
                className="max-w-sm"
                value={merchantSearch}
                onChange={setMerchantSearch}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={id.ppob.searchMerchant} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              {subMenuLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : (
                <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {filteredMerchants.map((item) => (
                    <Button
                      key={item.id}
                      className="h-auto w-full justify-start gap-3 px-4 py-4 text-left"
                      isDisabled={Boolean(item.isTrouble)}
                      variant="outline"
                      onPress={() => setSelectedMerchant(item)}
                    >
                      {item.pathIcon && (
                        <img src={item.pathIcon} alt={item.merchant} className="h-8 w-8" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-medium">{item.merchant}</span>
                        {item.description && (
                          <span className="block text-sm text-muted">{item.description}</span>
                        )}
                        {item.label && (
                          <span className="block text-xs text-muted">{item.label}</span>
                        )}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Step 3: Payment Code Input */}
          {selectedMerchant && (
            <Card>
              <Card.Content className="space-y-4">
                <div>
                  <p className="font-medium">{selectedMerchant.merchant}</p>
                  {selectedMerchant.description && (
                    <p className="text-sm text-muted">{selectedMerchant.description}</p>
                  )}
                </div>
                <TextField fullWidth value={paymentCode} onChange={setPaymentCode}>
                  <Label className="text-base">{id.ppob.paymentCode}</Label>
                  <Input
                    className="h-12 font-mono text-xl"
                    placeholder={id.ppob.paymentCodePlaceholder}
                  />
                </TextField>
              </Card.Content>
            </Card>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedMerchant && paymentCode.length >= 6 ? (
              <Card className="border-accent">
                <Card.Header>
                  <Card.Title className="text-lg">{id.ppob.confirm}</Card.Title>
                </Card.Header>
                <Card.Content className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.selectGroup}</span>
                    <span className="font-medium">{selectedGroup?.group}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.selectMerchant}</span>
                    <span className="font-medium">{selectedMerchant.merchant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.paymentCode}</span>
                    <span className="font-mono text-base font-medium">{paymentCode}</span>
                  </div>
                  <Button className="mt-4 w-full" isDisabled size="lg">
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </Card.Content>
              </Card>
            ) : groups ? (
              <div className="py-8 text-center text-sm text-muted">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
