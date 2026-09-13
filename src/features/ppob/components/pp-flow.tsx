import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Alert, Breadcrumbs, Button, Card, Input, Label, Skeleton, TextField } from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { RupiahField } from "@/components/rupiah-field"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import { formatRupiah } from "@/lib/format"
import { id } from "@/i18n/id"
import { usePpobMenu, usePpSubMenu } from "../hooks"
import type { PpSearchGroupRef, PpobMenuGroup, PpSubMenuItem } from "../types"
import { ConfirmCard } from "./quick-access/confirm-card"
import { FlowColumns } from "./flow-columns"
import { PaymentPointIcon } from "./payment-point-icon"
import { TileButton } from "./tile-button"
import { TileGrid } from "./tile-grid"

/** What `ppob-home.tsx`'s search result hands this route to skip the group step. */
interface PpFlowPreselect {
  preselectGroup?: PpSearchGroupRef
  preselectItemId?: number
}

/** The synthetic group tile a search preselect starts from — its own icon is never shown. */
function groupFromPreselect(group: PpSearchGroupRef): PpobMenuGroup {
  return { id: group.id, group: group.name, imageUrl: null, pathIcon: null }
}

export function PpFlow() {
  const navigate = useNavigate()
  const location = useLocation()
  const preselect = location.state as PpFlowPreselect | null

  const [selectedGroup, setSelectedGroup] = useState<PpobMenuGroup | null>(() =>
    preselect?.preselectGroup ? groupFromPreselect(preselect.preselectGroup) : null,
  )
  const [selectedMerchant, setSelectedMerchant] = useState<PpSubMenuItem | null>(null)
  const [merchantSearch, setMerchantSearch] = useState("")
  const [paymentCode, setPaymentCode] = useState("")
  const [amount, setAmount] = useState<number | null>(null)

  const { data: groups, isLoading: groupsLoading } = usePpobMenu()
  const {
    data: subMenuItems,
    isLoading: subMenuLoading,
    isError: subMenuIsError,
    error: subMenuError,
  } = usePpSubMenu(selectedGroup?.id ?? 0)

  // The group half of a preselect is known synchronously (search already had
  // its id and name) and is applied above, as the state initializer. The
  // biller half is not: it only exists once this screen's own sub-menu fetch
  // resolves, so it is applied here — at most once, the same "adjust state
  // while rendering" pattern React recommends over an effect for deriving
  // state from a prop (https://react.dev/learn/you-might-not-need-an-effect).
  // Stepping back afterwards clears `selectedMerchant` but not `itemApplied`,
  // so it does not re-select the same biller.
  const [itemApplied, setItemApplied] = useState(false)

  if (!itemApplied && preselect?.preselectItemId !== undefined && subMenuItems) {
    setItemApplied(true)
    const match = subMenuItems.find((item) => item.id === preselect.preselectItemId)
    if (match) setSelectedMerchant(match)
  }

  const filteredMerchants = useMemo(() => {
    if (!subMenuItems) return []
    if (!merchantSearch) return subMenuItems
    const q = merchantSearch.toLowerCase()
    return subMenuItems.filter(
      (item) =>
        item.merchant.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    )
  }, [subMenuItems, merchantSearch])

  const goToGroups = () => {
    setSelectedGroup(null)
    setSelectedMerchant(null)
    setMerchantSearch("")
    setPaymentCode("")
    setAmount(null)
  }

  const goToMerchants = () => {
    setSelectedMerchant(null)
    setPaymentCode("")
    setAmount(null)
  }

  const handleBack = () => {
    if (selectedMerchant) {
      goToMerchants()
    } else if (selectedGroup) {
      goToGroups()
    } else {
      navigate("/ppob")
    }
  }

  const currentTitle = selectedMerchant
    ? selectedMerchant.merchant
    : selectedGroup
      ? selectedGroup.group
      : id.ppob.pp

  const codeReady = paymentCode.length >= 6
  const amountReady = !selectedMerchant?.inputAmt || (amount ?? 0) > 0
  const canConfirm = !!selectedMerchant && codeReady && amountReady

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader title={currentTitle} onBack={handleBack} />

      {selectedGroup && (
        <Breadcrumbs>
          <Breadcrumbs.Item onPress={goToGroups}>{id.ppob.pp}</Breadcrumbs.Item>
          <Breadcrumbs.Item onPress={selectedMerchant ? goToMerchants : undefined}>
            {selectedGroup.group}
          </Breadcrumbs.Item>
          {selectedMerchant && <Breadcrumbs.Item>{selectedMerchant.merchant}</Breadcrumbs.Item>}
        </Breadcrumbs>
      )}

      <FlowColumns
        aside={
          selectedMerchant && canConfirm ? (
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
                {
                  label: selectedMerchant.label || id.ppob.paymentCode,
                  value: paymentCode,
                  tone: "mono",
                },
                ...(selectedMerchant.inputAmt
                  ? [{ label: id.ppob.nominal, value: formatRupiah(amount ?? 0) }]
                  : []),
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
            <TileGrid>
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </TileGrid>
          ) : (
            <TileGrid>
              {groups?.map((group) => (
                <TileButton
                  key={group.id}
                  icon={<PaymentPointIcon className="size-8" pathIcon={group.pathIcon} />}
                  label={group.group}
                  onPress={() => setSelectedGroup(group)}
                />
              ))}
            </TileGrid>
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
              <TileGrid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </TileGrid>
            ) : subMenuIsError ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>
                    {subMenuError?.message ?? "Gagal memuat daftar merchant"}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : filteredMerchants.length === 0 ? (
              <NoData title={id.ppob.merchantNotFound} />
            ) : (
              // Merchant yang bermasalah tetap terlihat, ditandai `StatusBadge`
              // "Gangguan" di bawah namanya, tapi ubinnya tidak bisa ditekan.
              <TileGrid>
                {filteredMerchants.map((item) => (
                  <TileButton
                    key={item.id}
                    badge={
                      item.isTrouble ? (
                        <StatusBadge size="sm" status="warning">
                          {id.ppob.trouble}
                        </StatusBadge>
                      ) : undefined
                    }
                    description={item.isTrouble ? undefined : item.description || undefined}
                    icon={<PaymentPointIcon className="size-8" pathIcon={item.pathIcon} />}
                    isDisabled={!!item.isTrouble}
                    label={item.merchant}
                    onPress={() => setSelectedMerchant(item)}
                  />
                ))}
              </TileGrid>
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
            <Card.Content className="gap-4">
              <TextField
                fullWidth
                value={paymentCode}
                variant="secondary"
                onChange={setPaymentCode}
              >
                <Label>{selectedMerchant.label || id.ppob.paymentCode}</Label>
                <Input className="tabular-nums" placeholder={id.ppob.paymentCodePlaceholder} />
              </TextField>

              {selectedMerchant.inputAmt ? (
                <RupiahField label={id.ppob.nominal} value={amount} onChange={setAmount} />
              ) : null}
            </Card.Content>
          </Card>
        )}
      </FlowColumns>
    </div>
  )
}
