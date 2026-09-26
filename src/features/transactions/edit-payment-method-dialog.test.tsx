import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { id } from "@/i18n/id"
import { EditPaymentMethodDialog } from "./components/edit-payment-method-dialog"

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderDialog() {
  const client = new QueryClient()
  const ui = (isOpen: boolean, currentMethod: string) => (
    <QueryClientProvider client={client}>
      <EditPaymentMethodDialog
        currentMethod={currentMethod}
        isOpen={isOpen}
        isSplitPayment={currentMethod === "mixed"}
        transactionId={7}
        onClose={() => {}}
      />
    </QueryClientProvider>
  )
  const view = render(ui(false, "cash"))
  return { ...view, show: (isOpen: boolean, method: string) => view.rerender(ui(isOpen, method)) }
}

function methodSelect() {
  return screen.getByRole("button", { name: new RegExp(id.transactions.paymentMethod) })
}

/**
 * The starting method used to be computed on every render from the sale's
 * method, so a refetch of the sale behind the open dialog swapped the select
 * under the admin. It is taken once, when the dialog opens.
 */
describe("EditPaymentMethodDialog", () => {
  it("starts on the sale's method as it was when the dialog opened", async () => {
    const { show } = renderDialog()

    show(true, "cash")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(methodSelect()).toHaveAccessibleName(/Tunai/)

    // The sale is refetched while the dialog is open and now reads QRIS.
    show(true, "qris")
    expect(methodSelect()).toHaveAccessibleName(/Tunai/)
  })

  it("takes the sale's current method again on the next opening", async () => {
    const { show } = renderDialog()
    show(true, "cash")
    await screen.findByRole("dialog")

    show(false, "qris")
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    show(true, "qris")

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(methodSelect()).toHaveAccessibleName(/QRIS/)
  })
})
