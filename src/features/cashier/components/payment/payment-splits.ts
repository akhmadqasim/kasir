import { id } from "@/i18n/id"

import { isImplausiblePaymentAmount } from "../../payment-behavior"
import { formatRupiah } from "../../utils"
import type { PaymentSplitInput } from "../../types"
import { PAYMENT_METHODS } from "./payment-methods"

/**
 * The rules behind a split payment, as pure functions of the dialog's split
 * rows: which method a click toggles into, what "Uang Pas" fills in, and
 * whether the amounts add up. `usePaymentForm` holds the rows; this decides.
 */

/** Rupiah sums are floats; anything closer than this is equal. */
const EPSILON = 0.01

export interface PaymentSplitForm {
  payment_method: string
  bank_name: string
  amount: number | null
  selected: boolean
}

const CLEARED_SPLIT = { selected: false, amount: null, bank_name: "" } as const

/**
 * Only `method` selected. A non-cash method starts at the full `total`, the
 * same as picking it by hand does — cash is left empty for the cashier to
 * type what was handed over.
 */
export function createInitialPaymentSplits(method = "cash", total = 0): PaymentSplitForm[] {
  return PAYMENT_METHODS.map((candidate) => ({
    payment_method: candidate.value,
    bank_name: "",
    amount: candidate.value === method && method !== "cash" ? total : null,
    selected: candidate.value === method,
  }))
}

/** `splits` with `method`'s row patched by `next`. */
export function withSplit(
  splits: PaymentSplitForm[],
  method: string,
  next: Partial<PaymentSplitForm>,
): PaymentSplitForm[] {
  return splits.map((split) => (split.payment_method === method ? { ...split, ...next } : split))
}

function sumAmounts(splits: PaymentSplitForm[]): number {
  return splits.reduce((sum, split) => sum + (split.amount ?? 0), 0)
}

/**
 * The active method must always be one of the selected ones. Otherwise "Uang
 * Pas" and the quick amounts would fill a method that is not ticked — and
 * tick it. Derived rather than synced, so no render ever sees a stale one.
 */
export function resolveActivePaymentMethod(splits: PaymentSplitForm[], requested: string): string {
  const selected = splits.filter((split) => split.selected)
  if (selected.length === 0 || selected.some((split) => split.payment_method === requested)) {
    return requested
  }
  return selected[0].payment_method
}

/** "Uang Pas" for `method`: whatever the other selected methods leave of `total`. */
export function remainingAmountFor(
  splits: PaymentSplitForm[],
  method: string,
  total: number,
): number {
  const otherTotal = sumAmounts(
    splits.filter((split) => split.payment_method !== method && split.selected),
  )
  return Math.max(total - otherTotal, 0)
}

export interface MethodToggle {
  splits: PaymentSplitForm[]
  /** The method active after the toggle. */
  active: string
}

/** What a click on `method`'s button (or its shortcut) does to the rows. */
export function togglePaymentMethod(
  splits: PaymentSplitForm[],
  method: string,
  total: number,
  currentActive: string,
): MethodToggle {
  const split = splits.find((current) => current.payment_method === method)
  if (!split) return { splits, active: currentActive }

  const selected = splits.filter((current) => current.selected)

  // Already selected → a second click releases it. Unless it is the only
  // selected method: then it just becomes active, so something stays selected.
  if (split.selected) {
    if (selected.length <= 1) return { splits, active: method }

    const fallback = selected.find((current) => current.payment_method !== method)
    return {
      splits: withSplit(splits, method, CLEARED_SPLIT),
      active: fallback?.payment_method ?? "cash",
    }
  }

  // Not selected yet. While the selection is still cash alone, a new method
  // REPLACES it (radio); from then on every new method is ADDED (split).
  const isSingleCashSelection = selected.length === 1 && selected[0].payment_method === "cash"
  if (isSingleCashSelection && method !== "cash") {
    return {
      splits: splits.map((current) =>
        current.payment_method === method
          ? { ...current, selected: true, amount: current.amount ?? total }
          : { ...current, ...CLEARED_SPLIT },
      ),
      active: method,
    }
  }

  return {
    splits: withSplit(splits, method, {
      selected: true,
      amount: method === "cash" ? null : split.amount,
    }),
    active: method,
  }
}

export interface PaymentSummary {
  selectedPaymentSplits: PaymentSplitForm[]
  selectedMethodCount: number
  /** Cash alone: the one case with a typed amount and change handed back. */
  isSingleCashSelection: boolean
  primaryPaymentAmount: number
  /** Single cash only; negative while the cash is short. */
  changeAmount: number
  /** Why a split does not add up, or `null`. Never set for a single method. */
  splitError: string | null
  /** Cash beyond what the non-cash legs leave, handed back; 0 = none. */
  splitCashChange: number
  /** A barcode that strayed into an amount field is always far above this. */
  hasImplausibleAmount: boolean
  /** The amounts are complete and consistent — the Bayar button's half of the rules. */
  isValid: boolean
  // What checkout sends.
  paymentMethod: string
  paymentAmount: number
  paymentBreakdown: PaymentSplitInput[] | undefined
}

export function summarizePayment(splits: PaymentSplitForm[], total: number): PaymentSummary {
  const selectedPaymentSplits = splits.filter((split) => split.selected)
  const selectedMethodCount = selectedPaymentSplits.length
  const primaryPaymentMethod = selectedPaymentSplits[0]?.payment_method ?? "cash"
  const primaryPaymentAmount = selectedPaymentSplits[0]?.amount ?? 0
  const isSingleCashSelection = selectedMethodCount === 1 && primaryPaymentMethod === "cash"
  const changeAmount = isSingleCashSelection ? primaryPaymentAmount - total : 0

  const totalSplitAmount = sumAmounts(selectedPaymentSplits)
  const cashSplits = selectedPaymentSplits.filter((split) => split.payment_method === "cash")
  const cashSplitAmount = sumAmounts(cashSplits)
  const nonCashSplitAmount = sumAmounts(
    selectedPaymentSplits.filter((split) => split.payment_method !== "cash"),
  )
  const splitDifference = total - totalSplitAmount
  const hasCashInSplit = cashSplits.length > 0

  const normalizedSplits: PaymentSplitInput[] = selectedPaymentSplits
    .filter((split) => split.payment_method && (split.amount ?? 0) > 0)
    .map((split) => ({
      payment_method: split.payment_method,
      bank_name: split.bank_name.trim() || undefined,
      amount: split.amount ?? 0,
    }))
  const splitMethods = normalizedSplits.map((split) => split.payment_method)
  const hasDuplicateSplitMethod = new Set(splitMethods).size !== splitMethods.length
  const allSelectedMethodsHaveAmount = selectedPaymentSplits.every(
    (split) => (split.amount ?? 0) > 0,
  )

  // One rule for the Bayar button and for the message/change the dialog shows.
  const isNonCashOverTotal = nonCashSplitAmount > total + EPSILON
  const isCashShort = cashSplitAmount + EPSILON < Math.max(total - nonCashSplitAmount, 0)
  const isSplitAmountValid = hasCashInSplit
    ? !isNonCashOverTotal && !isCashShort
    : Math.abs(splitDifference) < EPSILON
  const isSplitSelectionValid =
    normalizedSplits.length > 0 &&
    normalizedSplits.length === selectedPaymentSplits.length &&
    !hasDuplicateSplitMethod &&
    isSplitAmountValid

  const splitError =
    selectedMethodCount <= 1 || isSplitAmountValid
      ? null
      : hasCashInSplit
        ? isNonCashOverTotal
          ? id.cashier.nonCashOverTotal
          : id.cashier.cashShort(
              formatRupiah(Math.max(total - nonCashSplitAmount - cashSplitAmount, 0)),
            )
        : splitDifference > 0
          ? id.cashier.splitShort(formatRupiah(splitDifference))
          : id.cashier.splitOver(formatRupiah(Math.abs(splitDifference)))
  const splitCashChange =
    selectedMethodCount > 1 &&
    hasCashInSplit &&
    isSplitAmountValid &&
    totalSplitAmount - total > EPSILON
      ? totalSplitAmount - total
      : 0

  const hasImplausibleAmount = selectedPaymentSplits.some((split) =>
    isImplausiblePaymentAmount(split.amount ?? 0),
  )
  const isAmountValid = isSingleCashSelection
    ? primaryPaymentAmount >= total
    : allSelectedMethodsHaveAmount && isSplitSelectionValid

  return {
    selectedPaymentSplits,
    selectedMethodCount,
    isSingleCashSelection,
    primaryPaymentAmount,
    changeAmount,
    splitError,
    splitCashChange,
    hasImplausibleAmount,
    isValid: selectedMethodCount > 0 && !hasImplausibleAmount && isAmountValid,
    paymentMethod:
      selectedMethodCount > 1
        ? (normalizedSplits[0]?.payment_method ?? "cash")
        : primaryPaymentMethod,
    paymentAmount: isSingleCashSelection ? primaryPaymentAmount : totalSplitAmount,
    // A single cash sale is fully described by the two fields above; any
    // other single method may carry a bank/app name, which only the
    // breakdown has room for.
    paymentBreakdown:
      selectedMethodCount > 1 || primaryPaymentMethod !== "cash" ? normalizedSplits : undefined,
  }
}
