import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card, Input, Label, SearchField, Skeleton, TextField } from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"
import { usePpobMenu, usePpSubMenu } from "../hooks"
import type { PpobMenuGroup, PpSubMenuItem } from "../types"
import { FlowColumns } from "./flow-columns"
import { ConfirmCard } from "./quick-access/confirm-card"

export function PpFlow() {
  const navigate = useNavigate()
  const [selectedGroup, setSelectedGroup] = useState<PpobMenuGroup | null>(null)
  const [selectedMerchant, setSelectedMerchant] = useState<PpSubMenuItem | null>(null)
  const [merchantSearch, setMerchantSearch] = useState("")
  const [paymentCode, setPaymentCode] = useState("")

  const { data: groups, isLoading: groupsLoading } = usePpobMenu()
  const { data: subMenuItems, isLoading: subMenuLoading } = usePpSubMenu(selectedGroup?.id ?? 0)

  const filteredMerchants = useMemo(() => {
    if (!subMenuItems) return []
    if (!merchantSearch) return subMenuItems
    const q = merchantSearch.toLowerCase()
    return subMenuItems.filter(
      (item) =>
        item.merchant.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
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
    <div className="flex flex-col gap-6">
      <SubpageHeader title={currentTitle} onBack={handleBack} />

      <FlowColumns
        aside={
          selectedMerchant && paymentCode.length >= 6 ? (
            <ConfirmCard
              footer={
                <Button fullWidth isDisabled size="lg">
                  {id.ppob.process} (Coming Soon)
                </Button>
              }
              items={[
                { label: id.ppob.selectGroup, value: selectedGroup?.group ?? "-" },
                { label: id.ppob.selectMerchant, value: selectedMerchant.merchant },
                { label: id.ppob.paymentCode, value: paymentCode, tone: "mono" },
              ]}
              title={<Card.Title>{id.ppob.confirm}</Card.Title>}
            />
          ) : groups ? (
            <Card>
              <Card.Content>
                <NoData title="Pilih produk untuk melihat konfirmasi" />
              </Card.Content>
            </Card>
          ) : null
        }
      >
        {/* Step 1: Group Selection */}
        {!selectedGroup &&
          (groupsLoading ? (
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
                  className="h-auto flex-col gap-2 whitespace-normal py-6"
                  variant="secondary"
                  onPress={() => setSelectedGroup(group)}
                >
                  {group.pathIcon && <img src={group.pathIcon} alt="" className="size-8" />}
                  <span className="text-center">{group.group}</span>
                </Button>
              ))}
            </div>
          ))}

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
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : (
              <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                {filteredMerchants.map((item) => (
                  <Button
                    key={item.id}
                    fullWidth
                    className="h-auto justify-start gap-3 whitespace-normal px-4 py-4 text-left"
                    isDisabled={Boolean(item.isTrouble)}
                    variant="secondary"
                    onPress={() => setSelectedMerchant(item)}
                  >
                    {item.pathIcon && <img src={item.pathIcon} alt="" className="size-8" />}
                    <span className="min-w-0">
                      <span className="block">{item.merchant}</span>
                      {item.description && (
                        <span className="block text-muted">{item.description}</span>
                      )}
                      {item.label && <span className="block text-xs text-muted">{item.label}</span>}
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
            <Card.Header>
              <Card.Title>{selectedMerchant.merchant}</Card.Title>
              {selectedMerchant.description && (
                <Card.Description>{selectedMerchant.description}</Card.Description>
              )}
            </Card.Header>
            <Card.Content>
              <TextField
                fullWidth
                value={paymentCode}
                variant="secondary"
                onChange={setPaymentCode}
              >
                <Label>{id.ppob.paymentCode}</Label>
                <Input className="tabular-nums" placeholder={id.ppob.paymentCodePlaceholder} />
              </TextField>
            </Card.Content>
          </Card>
        )}
      </FlowColumns>
    </div>
  )
}
