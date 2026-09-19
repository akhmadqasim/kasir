import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Alert, Breadcrumbs, Button, Card, Input, Label, Skeleton, TextField } from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { RupiahField } from "@/components/rupiah-field"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import type { SummaryItem } from "@/components/summary-list"
import { formatRupiah } from "@/lib/format"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { usePpobMenu, usePpSubMenu, usePpobMarkup, usePaymentPointInquiry } from "../hooks"
import { resolvePpobSellPrice } from "../pricing"
import type { InquiryResult, PpSearchGroupRef, PpobMenuGroup, PpSubMenuItem } from "../types"
import { PpobCheckout } from "./checkout/ppob-checkout"
import { usePpobCheckout } from "./checkout/use-ppob-checkout"
import { ConfirmCard } from "./quick-access/confirm-card"
import { markupItem } from "./quick-access/markup-item"
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

/**
 * "Periode" is not a field on `InquiryResult` — only a handful of billers
 * (postpaid subscriptions) carry one, buried in whatever shape the upstream
 * answered with. Read defensively from the raw response and say nothing when
 * it is not there, the same way the admin fee row disappears for a biller
 * that does not charge one.
 */
function extractPeriodLabel(rawData: InquiryResult["rawData"] | undefined): string | null {
  if (!rawData) return null
  const nested = rawData.data
  const sources = [
    rawData,
    typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>) : null,
  ]

  for (const source of sources) {
    if (!source) continue
    for (const key of ["period", "periode"]) {
      const value = source[key]
      if (typeof value === "string" && value.trim()) return value
      if (typeof value === "number") return String(value)
    }
  }

  return null
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
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null)

  const { data: groups, isLoading: groupsLoading } = usePpobMenu()
  const {
    data: subMenuItems,
    isLoading: subMenuLoading,
    isError: subMenuIsError,
    error: subMenuError,
  } = usePpSubMenu(selectedGroup?.id ?? 0)
  const { getMarkupConfig, customPrices } = usePpobMarkup()
  const paymentPointInquiry = usePaymentPointInquiry()
  const checkout = usePpobCheckout()

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
    setInquiryResult(null)
  }

  const goToMerchants = () => {
    setSelectedMerchant(null)
    setPaymentCode("")
    setAmount(null)
    setInquiryResult(null)
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

  const trimmedCode = paymentCode.trim()
  const codeReady = trimmedCode.length > 0
  const amountReady = !selectedMerchant?.inputAmt || (amount ?? 0) > 0
  const canInquiry = !!selectedMerchant && codeReady && amountReady

  const handleInquiry = () => {
    if (!selectedMerchant || !canInquiry) return
    paymentPointInquiry.mutate(
      {
        customerId: trimmedCode,
        paymentPointGroupId: selectedMerchant.paymentPointGroupId,
        productCode: selectedMerchant.plu,
        ...(selectedMerchant.inputAmt ? { amount: amount ?? 0 } : {}),
      },
      {
        onSuccess: (result) => setInquiryResult(result),
        onError: (err) => toast.error(`Inquiry gagal: ${err.message}`),
      },
    )
  }

  // Yang dibayar toko ke vendor = tagihan + biaya admin.
  const vendorCost = inquiryResult?.total ?? 0
  const itemName = selectedMerchant ? `${selectedMerchant.merchant} - ${trimmedCode}` : ""
  const sellPrice = inquiryResult
    ? resolvePpobSellPrice({
        name: itemName,
        serviceType: "pp",
        vendorCost,
        markup: getMarkupConfig("pp"),
        customPrices,
      })
    : 0
  const period = extractPeriodLabel(inquiryResult?.rawData)

  const handleConfirm = () => {
    if (!inquiryResult || !selectedMerchant) return
    // Paid right here, in the ppob channel — never through the cashier's cart.
    checkout.begin({
      name: itemName,
      price: sellPrice,
      service_type: "pp",
      service_ref: trimmedCode,
      buy_price: vendorCost,
      ppob_product_code: selectedMerchant.plu,
      ppob_inquiry_id: inquiryResult.inquiryId,
    })
  }

  const confirmItems: SummaryItem[] | null =
    selectedMerchant && inquiryResult
      ? [
          { label: id.ppob.selectGroup, value: selectedGroup?.group ?? "-" },
          { label: id.ppob.selectMerchant, value: selectedMerchant.merchant },
          {
            label: selectedMerchant.label || id.ppob.paymentCode,
            value: trimmedCode,
            tone: "mono",
          },
          { label: "Nama", value: inquiryResult.customerName ?? "-" },
          ...(period ? [{ label: id.ppob.period, value: period }] : []),
          { label: "Tagihan", value: formatRupiah(inquiryResult.amount) },
          ...(inquiryResult.adminFee > 0
            ? [{ label: "Admin", value: formatRupiah(inquiryResult.adminFee) }]
            : []),
          ...(sellPrice > vendorCost ? [markupItem(sellPrice, vendorCost)] : []),
          { label: "Total Bayar", value: formatRupiah(sellPrice), tone: "strong" },
        ]
      : null

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
          confirmItems ? (
            <ConfirmCard
              scrollIntoView
              footer={
                <Button fullWidth size="lg" onPress={handleConfirm}>
                  {id.cashier.pay}
                </Button>
              }
              items={confirmItems}
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
                onChange={(value) => {
                  setPaymentCode(value)
                  setInquiryResult(null)
                }}
              >
                <Label>{selectedMerchant.label || id.ppob.paymentCode}</Label>
                <Input className="tabular-nums" placeholder={id.ppob.paymentCodePlaceholder} />
              </TextField>

              {selectedMerchant.inputAmt ? (
                <RupiahField
                  label={id.ppob.nominal}
                  value={amount}
                  onChange={(value) => {
                    setAmount(value)
                    setInquiryResult(null)
                  }}
                />
              ) : null}

              {!inquiryResult && (
                <PendingButton
                  fullWidth
                  isDisabled={!canInquiry}
                  isPending={paymentPointInquiry.isPending}
                  onPress={handleInquiry}
                >
                  Cek Tagihan
                </PendingButton>
              )}
            </Card.Content>
          </Card>
        )}
      </FlowColumns>

      <PpobCheckout checkout={checkout} onDone={() => navigate("/ppob")} />
    </div>
  )
}
