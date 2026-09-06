import { useState, useCallback } from "react"
import { Upload, FileSpreadsheet, CheckCircle2, Download } from "lucide-react"
import { read, utils, type WorkBook } from "xlsx"
import {
  Alert,
  Button,
  Label,
  ListBox,
  Modal,
  ScrollShadow,
  Select,
  Table,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { selectedText } from "@/components/selected-text"
import { StatusBadge } from "@/components/status-badge"
import { useApiMutation } from "@/hooks/use-api"
import { bulkCreateProducts, downloadImportTemplate } from "@/lib/api/products"
import { queryKeys } from "@/lib/api/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { parseIndonesianInteger, parseIndonesianNumber } from "@/lib/format"
import type { BulkProductInput, BulkImportResult } from "../types"

interface MappedRows {
  products: BulkProductInput[]
  /** 1-based positions of data rows dropped before the backend ever sees them. */
  skippedRowNumbers: number[]
}

/** "3, 7, 12 dan 4 lainnya" — keeps the warning readable for large files. */
function formatRowList(rowNumbers: number[], limit = 10): string {
  const shown = rowNumbers.slice(0, limit).join(", ")
  const rest = rowNumbers.length - limit
  return rest > 0 ? `${shown} dan ${rest} lainnya` : shown
}

/** Validate EAN/UPC check digit for a barcode string of 8, 12, or 13 digits */
function isValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code)) return false
  const len = code.length
  if (len !== 8 && len !== 12 && len !== 13) return false
  const digits = code.split("").map(Number)
  const check = digits.pop()!
  const sum = digits.reduce((acc, d, i) => {
    const weight = len === 13 ? (i % 2 === 0 ? 1 : 3) : (i % 2 === 0 ? 3 : 1)
    return acc + d * weight
  }, 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Pad barcode with leading zeros to standard lengths and validate check digit */
function fixBarcodeLeadingZero(value: string): string {
  if (!value || !/^\d+$/.test(value)) return value
  if (value.startsWith("0")) return value
  const len = value.length
  // Already a standard length - leave as is
  if (len === 8 || len === 12 || len === 13) return value
  // Try padding to each standard barcode length (smallest first)
  for (const targetLen of [8, 12, 13]) {
    if (len < targetLen) {
      const padded = value.padStart(targetLen, "0")
      if (isValidCheckDigit(padded)) return padded
    }
  }
  return value
}

const TARGET_FIELDS = [
  { key: "skip", label: "-- Lewati --" },
  { key: "name", label: "Produk (Nama)" },
  { key: "barcode", label: "Barcode" },
  { key: "category_name", label: "Kategori" },
  { key: "buy_price", label: "HPP (Harga Beli)" },
  { key: "margin", label: "Margin (%)" },
  { key: "sell_price", label: "Harga Jual" },
  { key: "stock", label: "Stok" },
  { key: "unit", label: "Satuan" },
] as const

type TargetFieldKey = (typeof TARGET_FIELDS)[number]["key"]

const COLUMN_MAPPING: Record<string, TargetFieldKey> = {
  "nama": "name",
  "nama produk": "name",
  "produk": "name",
  "product": "name",
  "name": "name",
  "barcode": "barcode",
  "kategori": "category_name",
  "kategori produk": "category_name",
  "category": "category_name",
  "harga beli": "buy_price",
  "harga modal": "buy_price",
  "hpp": "buy_price",
  "buy price": "buy_price",
  "cost": "buy_price",
  "harga jual": "sell_price",
  "harga": "sell_price",
  "sell price": "sell_price",
  "price": "sell_price",
  "stok": "stock",
  "stock": "stock",
  "satuan": "unit",
  "unit": "unit",
  "no": "skip",
  "toko": "skip",
  "pemasok": "skip",
  "supplier": "skip",
  "margin": "margin",
  "margin (%)": "margin",
}

function autoMapColumns(headers: string[]): Record<number, TargetFieldKey> {
  const result: Record<number, TargetFieldKey> = {}
  headers.forEach((header, idx) => {
    const normalized = header.trim().toLowerCase()
    const match = COLUMN_MAPPING[normalized]
    if (match) {
      result[idx] = match
    }
  })
  return result
}

/**
 * The template is now generated and served by the server, and arrives as an
 * ordinary browser download.
 *
 * The old command took the CSV text *and the filename* from this component and
 * wrote them to the user's Desktop — a path the webview chose, which stopped
 * being acceptable the moment the webview could be a tablet on the LAN. Nothing
 * on this side writes a file any more.
 */
async function downloadSampleTemplate() {
  try {
    await downloadImportTemplate()
    toast.success("Template diunduh")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Gagal mengunduh template")
  }
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = "upload" | "mapping" | "result"

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const [step, setStep] = useState<Step>("upload")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [columnMap, setColumnMap] = useState<Record<number, TargetFieldKey>>({})
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const queryClient = useQueryClient()

  const importMutation = useApiMutation<BulkImportResult, BulkProductInput[]>(
    bulkCreateProducts
  )

  const resetState = useCallback(() => {
    setStep("upload")
    setHeaders([])
    setRows([])
    setColumnMap({})
    setResult(null)
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState()
    onOpenChange(open)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb: WorkBook = read(data, { type: "array" })

        // Auto-detect sheet with most data rows
        let bestSheet = wb.SheetNames[0]
        let bestRowCount = 0
        for (const name of wb.SheetNames) {
          const s = wb.Sheets[name]
          const rows: unknown[][] = utils.sheet_to_json(s, { header: 1 })
          if (rows.length > bestRowCount) {
            bestRowCount = rows.length
            bestSheet = name
          }
        }
        const sheet = wb.Sheets[bestSheet]

        // Read cells directly to properly handle barcodes with leading zeros
        const ref = sheet["!ref"]
        if (!ref) {
          toast.error("Sheet kosong")
          return
        }
        const range = utils.decode_range(ref)
        const stringRows: string[][] = []
        for (let r = range.s.r; r <= range.e.r; r++) {
          const row: string[] = []
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[utils.encode_cell({ r, c })]
            if (!cell) {
              row.push("")
              continue
            }
            if (cell.t === "s") {
              // Text cell — preserves leading zeros
              row.push(String(cell.v ?? "").trim())
            } else if (cell.t === "n") {
              // Number cell — prefer formatted text (preserves custom formats like leading zeros)
              const w = cell.w as string | undefined
              if (w && !/[eE]/.test(w)) {
                row.push(w.trim())
              } else {
                const num = cell.v as number
                row.push(Number.isFinite(num) ? num.toFixed(0) : String(num))
              }
            } else {
              row.push(String(cell.w ?? cell.v ?? "").trim())
            }
          }
          stringRows.push(row)
        }

        // Auto-detect header row by looking for known column names
        const knownHeaders = ["produk", "barcode", "harga", "stok", "nama", "nama produk", "hpp"]
        let headerRowIdx = 0
        for (let i = 0; i < Math.min(10, stringRows.length); i++) {
          const rowLower = stringRows[i].map((c) => c.toLowerCase())
          const matchCount = rowLower.filter((c) => knownHeaders.includes(c)).length
          if (matchCount >= 2) {
            headerRowIdx = i
            break
          }
        }

        if (stringRows.length <= headerRowIdx + 1) {
          toast.error("File kosong atau format tidak sesuai")
          return
        }

        const fileHeaders = stringRows[headerRowIdx].map((h) => String(h || "").trim())
        const dataRows = stringRows
          .slice(headerRowIdx + 1)
          .filter((row) => row.some((cell) => String(cell).trim() !== ""))

        if (dataRows.length === 0) {
          toast.error("Tidak ada data produk ditemukan")
          return
        }

        setHeaders(fileHeaders)
        setRows(dataRows)
        setColumnMap(autoMapColumns(fileHeaders))
        setStep("mapping")
      } catch {
        toast.error("Gagal membaca file")
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ""
  }

  const handleColumnMapChange = (colIdx: number, value: TargetFieldKey) => {
    setColumnMap((prev) => ({ ...prev, [colIdx]: value }))
  }

  const getMappedProducts = (): MappedRows => {
    const products: BulkProductInput[] = []
    const skippedRowNumbers: number[] = []

    rows.forEach((row, rowIdx) => {
      const product: Record<string, string> = {}
      Object.entries(columnMap).forEach(([colIdxStr, field]) => {
        if (field === "skip") return
        const colIdx = parseInt(colIdxStr, 10)
        product[field] = String(row[colIdx] ?? "").trim()
      })

      if (!product.name) {
        // Row numbers are 1-based and relative to the data rows shown in the preview.
        skippedRowNumbers.push(rowIdx + 1)
        return
      }

      products.push({
        name: product.name,
        barcode: fixBarcodeLeadingZero(product.barcode || "") || undefined,
        category_name: product.category_name || undefined,
        buy_price: parseIndonesianNumber(product.buy_price) ?? 0,
        sell_price: parseIndonesianNumber(product.sell_price) ?? 0,
        margin: parseIndonesianNumber(product.margin) ?? 0,
        stock: parseIndonesianInteger(product.stock) ?? 0,
        unit: product.unit || "pcs",
      })
    })

    return { products, skippedRowNumbers }
  }

  const handleImport = async () => {
    const { products, skippedRowNumbers } = getMappedProducts()
    if (products.length === 0) {
      toast.error("Tidak ada produk valid untuk diimport")
      return
    }

    try {
      const res = await importMutation.mutateAsync(products)
      // Rows dropped here never reach the backend, so its counters cannot see them.
      // Fold them in so the totals add up to the number of rows in the file.
      setResult({
        ...res,
        skipped: res.skipped + skippedRowNumbers.length,
        errors: skippedRowNumbers.length
          ? [
              ...res.errors,
              `${skippedRowNumbers.length} baris dilewati karena kolom nama kosong (baris ${formatRowList(skippedRowNumbers)})`,
            ]
          : res.errors,
      })
      setStep("result")
      // A bulk import creates categories as well as products.
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal import produk")
    }
  }

  const mappedCount = getMappedFieldCount()

  function getMappedFieldCount() {
    const mapped = new Set(
      Object.values(columnMap).filter((v) => v !== "skip")
    )
    return mapped.size
  }

  const hasNameMapped = Object.values(columnMap).includes("name")
  const hasPriceMapped = Object.values(columnMap).includes("sell_price")

  const previewRows = rows.slice(0, 10)

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
      <Modal.Container scroll="inside" size="lg">
        <Modal.Dialog aria-label={id.products.importProducts} className="max-h-[90vh] sm:max-w-6xl">
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {id.products.importProducts}
            </Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>

          <Modal.Body className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {step === "upload" && "Upload file CSV atau Excel untuk mengimport produk"}
              {step === "mapping" && `${rows.length} baris ditemukan — mapping kolom ke field produk`}
              {step === "result" && "Hasil import"}
            </p>

            {step === "upload" && (
              <div className="flex flex-col gap-2 py-4">
                <p className="text-sm font-medium">File</p>
                {/* Input filenya sengaja tetap HTML biasa: `<label>` yang
                    membungkusnya sekaligus jadi nama aksesibel dan area drop. */}
                <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-accent hover:bg-default/50">
                  <Upload className="h-10 w-10 text-muted" />
                  <div>
                    <p className="font-medium">Klik untuk memilih file</p>
                    <p className="text-sm text-muted">
                      .xlsx, .xls, .csv — kolom akan otomatis dideteksi
                    </p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv,.tsv"
                    onChange={handleFileChange}
                  />
                </label>
                <Button
                  className="h-auto self-start p-0 text-xs"
                  size="sm"
                  variant="ghost"
                  onPress={downloadSampleTemplate}
                >
                  <Download className="mr-1 h-3 w-3" />
                  Download contoh template
                </Button>
              </div>
            )}

            {step === "mapping" && (
              <>
                {/* Column Mapping */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Mapping Kolom</p>
                    <StatusBadge status="neutral" size="sm">
                      {mappedCount} field dimapping
                    </StatusBadge>
                  </div>
                  <ScrollShadow className="max-h-64">
                    <div className="grid grid-cols-2 gap-3">
                      {headers.map((header, idx) => {
                        const columnLabel = header || `Kolom ${idx + 1}`
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="min-w-[160px] truncate text-sm font-medium">
                              {columnLabel}
                            </span>
                            <Select
                              aria-label={`Field untuk ${columnLabel}`}
                              className="flex-1"
                              value={columnMap[idx] ?? "skip"}
                              onChange={(value) =>
                                handleColumnMapChange(
                                  idx,
                                  (value === null ? "skip" : String(value)) as TargetFieldKey
                                )
                              }
                            >
                              <Select.Trigger>
                                <Select.Value>{selectedText}</Select.Value>
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {TARGET_FIELDS.map((field) => (
                                    <ListBox.Item
                                      key={field.key}
                                      id={field.key}
                                      textValue={field.label}
                                    >
                                      <Label>{field.label}</Label>
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          </div>
                        )
                      })}
                    </div>
                  </ScrollShadow>
                </div>

                {!hasNameMapped && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>
                        Kolom "Produk (Nama)" wajib dimapping
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}

                {/* Preview Table */}
                <div className="min-h-0 flex-1">
                  <p className="mb-2 text-sm font-medium">
                    Preview ({previewRows.length} dari {rows.length} baris)
                  </p>
                  <Table variant="secondary">
                    <Table.ScrollContainer className="h-48">
                      <Table.Content aria-label="Preview data import">
                        <Table.Header>
                          {headers.map((header, colIdx) => {
                            const mapped = columnMap[colIdx]
                            const field = TARGET_FIELDS.find((f) => f.key === mapped)
                            return (
                              <Table.Column
                                key={colIdx}
                                className="text-xs whitespace-nowrap"
                                id={String(colIdx)}
                                isRowHeader={colIdx === 0}
                              >
                                {field && mapped !== "skip" ? (
                                  <StatusBadge status="info" size="sm">
                                    {field.label}
                                  </StatusBadge>
                                ) : (
                                  <span className="text-muted">{header}</span>
                                )}
                              </Table.Column>
                            )
                          })}
                        </Table.Header>
                        <Table.Body>
                          {previewRows.map((row, rowIdx) => (
                            <Table.Row key={rowIdx} id={rowIdx} textValue={`Baris ${rowIdx + 1}`}>
                              {headers.map((_, colIdx) => (
                                <Table.Cell key={colIdx} className="text-xs whitespace-nowrap">
                                  {String(row[colIdx] ?? "")}
                                </Table.Cell>
                              ))}
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>
              </>
            )}

            {step === "result" && result && (
              <div className="flex flex-col gap-4 py-4">
                <div className="flex items-center gap-3 rounded-lg border bg-default/50 p-4">
                  <CheckCircle2 className="h-8 w-8 text-success" />
                  <div>
                    <p className="text-lg font-semibold">Import Selesai</p>
                    <p className="text-sm text-muted">
                      {result.imported} diimport, {result.updated} diupdate,{" "}
                      {result.skipped} dilewati
                    </p>
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Peringatan ({result.errors.length})</p>
                    <ScrollShadow className="max-h-32 rounded-md border p-3">
                      {result.errors.map((err, i) => (
                        <p key={i} className="text-xs text-danger">
                          {err}
                        </p>
                      ))}
                    </ScrollShadow>
                  </div>
                )}
              </div>
            )}
          </Modal.Body>

          {step === "mapping" && (
            <Modal.Footer className="justify-between">
              <Button variant="outline" onPress={resetState}>
                {id.common.back}
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">
                  {getMappedProducts().products.length} produk valid
                </span>
                <Button
                  isDisabled={!hasNameMapped || !hasPriceMapped || importMutation.isPending}
                  onPress={handleImport}
                >
                  {importMutation.isPending ? id.products.importing : id.products.startImport}
                </Button>
              </div>
            </Modal.Footer>
          )}

          {step === "result" && result && (
            <Modal.Footer>
              <Button variant="outline" onPress={resetState}>
                Import Lagi
              </Button>
              <Button onPress={() => handleOpenChange(false)}>Selesai</Button>
            </Modal.Footer>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
