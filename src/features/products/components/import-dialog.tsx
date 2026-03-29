import { useState, useCallback } from "react"
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download } from "lucide-react"
import { toast } from "sonner"
import { read, utils, type WorkBook } from "xlsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useTauriMutation } from "@/hooks/use-tauri-command"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useQueryClient } from "@tanstack/react-query"
import type { BulkProductInput, BulkImportResult } from "../types"

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

async function downloadSampleTemplate() {
  const headers = ["Nama Produk", "Barcode", "Kategori", "Harga Beli", "Harga Jual", "Stok", "Satuan"]
  const sampleRows = [
    ["Indomie Goreng", "8996001010013", "Mie Instan", "2500", "3000", "100", "pcs"],
    ["Gula Pasir 1kg", "8991002101036", "Bahan Pokok", "14000", "16000", "50", "pcs"],
    ["Minyak Goreng 1L", "", "Minyak", "18000", "20000", "30", "pcs"],
  ]
  const csvContent = [headers, ...sampleRows].map((row) => row.join(",")).join("\n")

  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("save_template_file", { content: csvContent, filename: "template-import-produk.csv" })
    toast.success("Template berhasil disimpan di Desktop")
  } catch (err) {
    toast.error(typeof err === "string" ? err : "Gagal menyimpan template")
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
  const user = useAuthStore((s) => s.user)

  const importMutation = useTauriMutation<BulkImportResult, { products: BulkProductInput[]; callerId: number }>(
    "bulk_create_products"
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

        const allRows: string[][] = utils.sheet_to_json(sheet, {
          header: 1,
          raw: true,
          defval: "",
        })

        // Convert all values to strings, fixing scientific notation for barcodes
        const stringRows = allRows.map((row) =>
          row.map((cell) => {
            if (typeof cell === "number" && cell > 1e10) {
              return Math.round(cell).toString()
            }
            return String(cell ?? "").trim()
          })
        )

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

  const getMappedProducts = (): BulkProductInput[] => {
    const results: BulkProductInput[] = []
    for (const row of rows) {
      const product: Record<string, string> = {}
      Object.entries(columnMap).forEach(([colIdxStr, field]) => {
        if (field === "skip") return
        const colIdx = parseInt(colIdxStr, 10)
        product[field] = String(row[colIdx] ?? "").trim()
      })

      if (!product.name) continue

      results.push({
        name: product.name,
        barcode: product.barcode || undefined,
        category_name: product.category_name || undefined,
        buy_price: parseFloat(product.buy_price) || 0,
        sell_price: parseFloat(product.sell_price) || 0,
        margin: parseFloat(product.margin) || 0,
        stock: parseInt(product.stock, 10) || 0,
        unit: product.unit || "pcs",
      })
    }
    return results
  }

  const handleImport = async () => {
    const products = getMappedProducts()
    if (products.length === 0) {
      toast.error("Tidak ada produk valid untuk diimport")
      return
    }

    try {
      const res = await importMutation.mutateAsync({ products, callerId: user!.id })
      setResult(res)
      setStep("result")
      queryClient.invalidateQueries({ queryKey: ["search_products"] })
      queryClient.invalidateQueries({ queryKey: ["list_categories"] })
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Produk
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload file CSV atau Excel untuk mengimport produk"}
            {step === "mapping" && `${rows.length} baris ditemukan — mapping kolom ke field produk`}
            {step === "result" && "Hasil import"}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="flex flex-col gap-6 py-4">
            <div className="space-y-2">
              <Label>File</Label>
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary hover:bg-muted/50">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">Klik untuk memilih file</p>
                  <p className="text-sm text-muted-foreground">
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
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={downloadSampleTemplate}
              >
                <Download className="mr-1 h-3 w-3" />
                Download contoh template
              </Button>
            </div>
          </div>
        )}

        {step === "mapping" && (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            {/* Column Mapping */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label>Mapping Kolom</Label>
                <Badge variant="secondary">{mappedCount} field dimapping</Badge>
              </div>
              <ScrollArea className="max-h-64">
                <div className="grid grid-cols-2 gap-3">
                  {headers.map((header, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="min-w-[160px] truncate text-sm font-medium">
                        {header || `Kolom ${idx + 1}`}
                      </span>
                      <Select
                        value={columnMap[idx] ?? "skip"}
                        onValueChange={(v) =>
                          handleColumnMapChange(idx, v as TargetFieldKey)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELDS.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {!hasNameMapped && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Kolom "Produk (Nama)" wajib dimapping
                </AlertDescription>
              </Alert>
            )}

            {/* Preview Table */}
            <div className="flex-1 overflow-hidden">
              <Label className="mb-2 block">
                Preview ({Math.min(rows.length, 10)} dari {rows.length} baris)
              </Label>
              <ScrollArea className="h-48 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h, i) => {
                        const mapped = columnMap[i]
                        const field = TARGET_FIELDS.find((f) => f.key === mapped)
                        return (
                          <TableHead key={i} className="text-xs whitespace-nowrap">
                            {field && mapped !== "skip" ? (
                              <Badge variant="outline" className="text-xs">
                                {field.label}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">{h}</span>
                            )}
                          </TableHead>
                        )
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 10).map((row, rowIdx) => (
                      <TableRow key={rowIdx}>
                        {headers.map((_, colIdx) => (
                          <TableCell key={colIdx} className="text-xs whitespace-nowrap">
                            {String(row[colIdx] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" onClick={resetState}>
                Kembali
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {getMappedProducts().length} produk valid
                </span>
                <Button
                  onClick={handleImport}
                  disabled={
                    !hasNameMapped ||
                    !hasPriceMapped ||
                    importMutation.isPending
                  }
                >
                  {importMutation.isPending ? "Mengimport..." : "Mulai Import"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-lg font-semibold">Import Selesai</p>
                <p className="text-sm text-muted-foreground">
                  {result.imported} diimport, {result.updated} diupdate,{" "}
                  {result.skipped} dilewati
                </p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <Label>Peringatan ({result.errors.length})</Label>
                <ScrollArea className="max-h-32 rounded-md border p-3">
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-xs text-destructive">
                      {err}
                    </p>
                  ))}
                </ScrollArea>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={resetState}>
                Import Lagi
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Selesai</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
