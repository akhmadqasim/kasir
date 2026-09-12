import type {
  CashFlow,
  CreateCashFlowInput,
  OpenShiftInput,
  Shift,
  ShiftSummary,
} from "@/features/shift/types"
import { apiDelete, apiGet, apiPost } from "./client"

/**
 * Shifts and the cash that moves through the drawer during one.
 *
 * Four of these used to take a `userId` from the payload and none of them
 * checked it, so a cashier could open a shift or read someone else's by editing
 * a number. The owner is now the session: `openShift` opens *your* shift and
 * `getActiveShift` answers about *yours*.
 */

export function openShift(input: OpenShiftInput): Promise<Shift> {
  return apiPost<Shift>("/shifts", input)
}

/** The caller's own open shift, or `null`. */
export function getActiveShift(): Promise<Shift | null> {
  return apiGet<Shift | null>("/shifts/active")
}

export function closeShift(
  shiftId: number,
  body: { closingCash?: number; notes?: string },
): Promise<ShiftSummary> {
  return apiPost<ShiftSummary>(`/shifts/${shiftId}/close`, body)
}

export function getShiftSummary(shiftId: number): Promise<ShiftSummary> {
  return apiGet<ShiftSummary>(`/shifts/${shiftId}/summary`)
}

export function listCashFlows(shiftId: number): Promise<CashFlow[]> {
  return apiGet<CashFlow[]>(`/shifts/${shiftId}/cash-flows`)
}

export function createCashFlow(input: CreateCashFlowInput): Promise<CashFlow> {
  const { shiftId, ...body } = input
  return apiPost<CashFlow>(`/shifts/${shiftId}/cash-flows`, body)
}

/** Allowed for the entry's author or an admin, and only while the shift is open. */
export function deleteCashFlow(cashFlowId: number): Promise<void> {
  return apiDelete<void>(`/cash-flows/${cashFlowId}`)
}
