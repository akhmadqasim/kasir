import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  Skeleton,
  Surface,
  TextField,
} from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { SearchInput } from "@/components/search-input"
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
                // Pembayaran PP belum tersambung ke backend; tombolnya tetap ada
                // supaya bentuk kartunya sama dengan flow lain.
                <Button fullWidth isDisabled size="lg">
                  {id.ppob.notAvailable}
                </Button>
              }
              items={[
                { label: id.ppob.selectGroup, value: selectedGroup?.group ?? "-" },
                { label: id.ppob.selectMerchant, value: selectedMerchant.merchant },
                { label: id.ppob.paymentCode, value: paymentCode, tone: "mono" },
              ]}
              title={id.ppob.confirm}
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
            <SearchInput
              aria-label={id.ppob.searchMerchant}
              className="max-w-sm"
              placeholder={id.ppob.searchMerchant}
              value={merchantSearch}
              onChange={setMerchantSearch}
            />

            {subMenuLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : filteredMerchants.length === 0 ? (
              <NoData title={id.ppob.merchantNotFound} />
            ) : (
              // Daftar aksi seperti contoh "With Sections" ListBox: `Surface`
              // membingkainya, `onAction` memilih. Merchant yang bermasalah tetap
              // terlihat tapi tidak bisa dipilih.
              <Surface className="max-h-[60vh] overflow-y-auto">
                <ListBox
                  aria-label={id.ppob.selectMerchant}
                  className="p-2"
                  disabledKeys={filteredMerchants
                    .filter((item) => item.isTrouble)
                    .map((item) => item.id)}
                  selectionMode="none"
                  onAction={(key) => {
                    const item = filteredMerchants.find((candidate) => candidate.id === key)
                    if (item) setSelectedMerchant(item)
                  }}
                >
                  {filteredMerchants.map((item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.merchant}>
                      {item.pathIcon && <img src={item.pathIcon} alt="" className="size-8" />}
                      <div className="flex min-w-0 flex-col">
                        <Label>{item.merchant}</Label>
                        {item.description && <Description>{item.description}</Description>}
                        {item.label && <Description>{item.label}</Description>}
                      </div>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Surface>
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
