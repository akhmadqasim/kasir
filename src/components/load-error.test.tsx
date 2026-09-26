import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { Button, Table } from "@heroui/react"

import { LoadError } from "./load-error"
import { TableSkeletonRows } from "./table-skeleton-rows"

describe("LoadError", () => {
  it("announces the failure with its reason and retries on Coba lagi", () => {
    const onRetry = vi.fn()
    render(
      <LoadError title="Gagal memuat produk" onRetry={onRetry}>
        Server tidak menjawab
      </LoadError>,
    )

    const alert = screen.getByRole("alert")
    expect(within(alert).getByText("Gagal memuat produk")).toBeInTheDocument()
    expect(within(alert).getByText("Server tidak menjawab")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps the retry from being pressed again while it runs", () => {
    const onRetry = vi.fn()
    render(<LoadError isRetrying title="Gagal memuat produk" onRetry={onRetry} />)

    const retry = screen.getByRole("button", { name: /Coba lagi/ })
    fireEvent.click(retry)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("puts a secondary action before the retry, and offers no retry without onRetry", () => {
    const { rerender } = render(
      <LoadError
        secondaryAction={<Button size="sm">Kembali</Button>}
        title="Gagal memuat transaksi"
        onRetry={() => {}}
      />,
    )
    const buttons = screen.getAllByRole("button")
    expect(buttons.map((button) => button.textContent)).toEqual(["Kembali", "Coba lagi"])

    rerender(<LoadError title="Gagal memuat backup" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("TableSkeletonRows", () => {
  it("fills the body with one skeleton cell per column, as rows of the table itself", () => {
    render(
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Uji">
            <Table.Header>
              <Table.Column isRowHeader>Nama</Table.Column>
              <Table.Column>Stok</Table.Column>
              <Table.Column>Harga</Table.Column>
            </Table.Header>
            <Table.Body>
              <TableSkeletonRows columns={3} rows={4} />
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>,
    )

    const rows = within(screen.getByRole("grid", { name: "Uji" })).getAllByRole("row")
    // The header row, then the four skeleton rows.
    expect(rows).toHaveLength(5)
    for (const row of rows.slice(1)) {
      const cells = within(row)
      expect(
        cells.queryAllByRole("rowheader").length + cells.queryAllByRole("gridcell").length,
      ).toBe(3)
    }
  })
})
