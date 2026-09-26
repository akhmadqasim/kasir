import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Breadcrumbs, Button, Card } from "@heroui/react"
import { CreditCard } from "lucide-react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { usePpobMenu, usePpSubMenu, usePpobMarkup, usePaymentPointInquiry } from "../hooks"
import { resolvePpobSellPrice } from "../pricing"
import type { PpSearchGroupRef, PpobMenuGroup, PpSubMenuItem } from "../types"
import { useInquiryResult } from "./quick-access/use-inquiry-result"
import { PpobCheckout } from "./checkout/ppob-checkout"
import { usePpobCheckout } from "./checkout/use-ppob-checkout"
import { ConfirmCard } from "./quick-access/confirm-card"
import { FlowColumns } from "./flow-columns"
import { buildPpConfirmItems } from "./pp/pp-confirm-items"
import { PpCodeStep } from "./pp/pp-code-step"
import { PpGroupStep } from "./pp/pp-group-step"
import { PpMerchantStep } from "./pp/pp-merchant-step"

/** What `ppob-home.tsx`'s search result hands this route to skip the group step. */
interface PpFlowPreselect {
  preselectGroup?: PpSearchGroupRef
  preselectItemId?: number
}

/** The synthetic group tile a search preselect starts from — its own icon is never shown. */
function groupFromPreselect(group: PpSearchGroupRef): PpobMenuGroup {
  return { id: group.id, group: group.name, imageUrl: null, pathIcon: null }
}

/** Payment Point: kategori → biller → kode pembayaran → konfirmasi, lalu bayar di tempat. */
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
  const { result: inquiryResult, reset: resetInquiry, accept: acceptInquiry } = useInquiryResult()

  const groupsQuery = usePpobMenu()
  const subMenuQuery = usePpSubMenu(selectedGroup?.id ?? 0)
  const subMenuItems = subMenuQuery.data
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
    // A biller under disruption stays on the merchant step, where its tile is disabled.
    if (match && !match.isTrouble) setSelectedMerchant(match)
  }

  const goToGroups = () => {
    setSelectedGroup(null)
    setSelectedMerchant(null)
    setMerchantSearch("")
    setPaymentCode("")
    setAmount(null)
    resetInquiry()
  }

  const goToMerchants = () => {
    setSelectedMerchant(null)
    setPaymentCode("")
    setAmount(null)
    resetInquiry()
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
    if (!selectedMerchant || !canInquiry || paymentPointInquiry.isPending) return
    paymentPointInquiry.mutate(
      {
        customerId: trimmedCode,
        paymentPointGroupId: selectedMerchant.paymentPointGroupId,
        productCode: selectedMerchant.plu,
        ...(selectedMerchant.inputAmt ? { amount: amount ?? 0 } : {}),
      },
      {
        onSuccess: acceptInquiry(),
        onError: (err) => toast.error(id.ppob.billCheckFailed(err.message)),
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

  const confirmItems =
    selectedMerchant && inquiryResult
      ? buildPpConfirmItems({
          groupName: selectedGroup?.group,
          merchant: selectedMerchant,
          paymentCode: trimmedCode,
          inquiry: inquiryResult,
          vendorCost,
          sellPrice,
        })
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
          ) : groupsQuery.data ? (
            <Card>
              <Card.Content>
                <NoData
                  icon={<CreditCard />}
                  title={
                    selectedMerchant
                      ? "Cek tagihan untuk melihat detail"
                      : "Pilih biller untuk melihat konfirmasi"
                  }
                />
              </Card.Content>
            </Card>
          ) : null
        }
      >
        {!selectedGroup && (
          <PpGroupStep
            error={groupsQuery.error}
            groups={groupsQuery.data}
            isLoading={groupsQuery.isLoading}
            isRetrying={groupsQuery.isFetching}
            onRetry={() => void groupsQuery.refetch()}
            onSelect={setSelectedGroup}
          />
        )}

        {selectedGroup && !selectedMerchant && (
          <PpMerchantStep
            error={subMenuQuery.error}
            isLoading={subMenuQuery.isLoading}
            isRetrying={subMenuQuery.isFetching}
            merchants={subMenuItems}
            search={merchantSearch}
            onRetry={() => void subMenuQuery.refetch()}
            onSearchChange={setMerchantSearch}
            onSelect={setSelectedMerchant}
          />
        )}

        {selectedMerchant && (
          <PpCodeStep
            amount={amount}
            canInquiry={canInquiry}
            hasInquiry={!!inquiryResult}
            isInquiring={paymentPointInquiry.isPending}
            merchant={selectedMerchant}
            paymentCode={paymentCode}
            onAmountChange={(value) => {
              setAmount(value)
              resetInquiry()
            }}
            onInquiry={handleInquiry}
            onPaymentCodeChange={(value) => {
              setPaymentCode(value)
              resetInquiry()
            }}
          />
        )}
      </FlowColumns>

      <PpobCheckout checkout={checkout} onDone={() => navigate("/ppob")} />
    </div>
  )
}
