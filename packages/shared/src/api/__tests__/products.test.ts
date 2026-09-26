import { describe, expect, it, vi } from "vitest"

import type { PaginatedProducts, Product } from "../../types/products"
import type { ApiClient } from "../client"
import { createProductsApi } from "../products"

function product(overrides: Partial<Product>): Product {
  return {
    id: 1,
    barcode: null,
    sku: null,
    name: "Gula",
    category_id: null,
    buy_price: 10_000,
    sell_price: 12_000,
    margin: 0,
    stock: 10,
    unit: "kg",
    min_stock: 0,
    is_active: true,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    ...overrides,
  }
}

function page(data: Product[], pageNumber: number, totalPages: number): PaginatedProducts {
  return { data, total: data.length, page: pageNumber, per_page: 200, total_pages: totalPages }
}

/** A client whose `get` answers from `pages` in order and whose `put` echoes the body. */
function fakeClient(pages: PaginatedProducts[]) {
  const get = vi.fn(async () => pages.shift())
  const put = vi.fn(async (_path: string, body: unknown) => body)
  const client = { get, put } as unknown as ApiClient
  return { client, get, put }
}

describe("productsApi.refetch", () => {
  it("pages through a name search until the id turns up", async () => {
    const target = product({ id: 7 })
    const { client, get } = fakeClient([
      page([product({ id: 1 }), product({ id: 2 })], 1, 2),
      page([target], 2, 2),
    ])

    await expect(createProductsApi(client).refetch(target)).resolves.toEqual(target)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("is null once the pages run out", async () => {
    const { client } = fakeClient([page([product({ id: 1 })], 1, 1)])

    await expect(createProductsApi(client).refetch(product({ id: 9 }))).resolves.toBeNull()
  })
})

describe("productsApi.patch", () => {
  it("builds the whole-row PUT from the server's current row, not the cached one", async () => {
    const cached = product({ stock: 10, name: "Gula" })
    const current = product({ stock: 7, name: "Gula Pasir" })
    const { client, put } = fakeClient([page([current], 1, 1)])

    await createProductsApi(client).patch(cached, { sell_price: 13_000 })

    expect(put).toHaveBeenCalledWith(
      "/products/1",
      expect.objectContaining({ name: "Gula Pasir", sell_price: 13_000 }),
    )
  })

  /** Stock the patch does not change stays out, so sales made meanwhile are kept. */
  it("leaves stock out of a price edit", async () => {
    const { client, put } = fakeClient([page([product({ stock: 7 })], 1, 1)])

    await createProductsApi(client).patch(product({}), { sell_price: 13_000 })

    const body = put.mock.calls[0]?.[1]
    expect(body).not.toHaveProperty("stock")
    expect(body).not.toHaveProperty("expected_stock")
  })

  it("sends a counted stock with the stock it was counted against", async () => {
    const { client, put } = fakeClient([page([product({ stock: 7 })], 1, 1)])

    await createProductsApi(client).adjustStock(product({ stock: 10 }), 5)

    expect(put).toHaveBeenCalledWith(
      "/products/1",
      expect.objectContaining({ stock: 5, expected_stock: 7 }),
    )
  })

  it("leaves stock out when the count matches the system stock", async () => {
    const { client, put } = fakeClient([page([product({ stock: 7 })], 1, 1)])

    await createProductsApi(client).adjustStock(product({}), 7)

    expect(put.mock.calls[0]?.[1]).not.toHaveProperty("stock")
  })

  it("refuses to write when the product can no longer be found", async () => {
    const { client, put } = fakeClient([page([], 1, 0)])

    await expect(createProductsApi(client).adjustStock(product({}), 3)).rejects.toMatchObject({
      code: "not_found",
    })
    expect(put).not.toHaveBeenCalled()
  })
})
