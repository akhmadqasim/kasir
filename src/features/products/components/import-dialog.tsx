import { useState, useCallback, useMemo, useRef } from "react"
import { FileSpreadsheet } from "lucide-react"
import { Button, Modal } from "@heroui/react"

import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { PendingButton } from "@/components/pending-button"
import { formatNumber } from "@/lib/format"
import { useBulkImportProducts } from "../hooks/use-products"
import {
  autoMapColumns,
  mapImportRows,
  missingRequiredFields,
  withSkippedRows,
  type ColumnMap,
  type TargetFieldKey,
} from "../import-mapping"
import { ImportSheetError, readSheetRows } from "../import-sheet"
import { ImportMappingStep } from "./import-mapping-step"
import { ImportResultStep } from "./import-result-step"
import { ImportUploadStep } from "./import-upload-step"
import type { BulkImportResult } from "../types"

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = "upload" | "mapping" | "result"

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const [step, setStep] = useState<Step>("upload")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [columnMap, setColumnMap] = useState<ColumnMap>({})
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [isReading, setIsReading] = useState(false)
  // Bumped on every reset: a FileReader or an import request that finishes after
  // the dialog was closed (or "Kembali" / "Import Lagi" pressed) must not push
  // its file or its result into the next session.
  const session = useRef(0)

  const importMutation = useBulkImportProducts()
  const { reset: resetImport } = importMutation

  const resetState = useCallback(() => {
    session.current += 1
    // Detach from an import still in flight: without this the next session
    // opens on a spinning "Mulai Import" and a disabled "Kembali" until the
    // old request answers. The request itself carries on — its result is
    // reported by toast below, and the product lists are still invalidated.
    resetImport()
    setStep("upload")
    setHeaders([])
    setRows([])
    setColumnMap({})
    setResult(null)
    setIsReading(false)
  }, [resetImport])

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState()
    onOpenChange(open)
  }

  const readFile = (file: File) => {
    const reader = new FileReader()
    const readSession = session.current
    setIsReading(true)
    reader.onerror = () => {
      if (readSession !== session.current) return
      setIsReading(false)
      toast.error(id.products.fileReadFailed)
    }
    reader.onload = (evt) => {
      if (readSession !== session.current) return
      setIsReading(false)
      try {
        const sheet = readSheetRows(evt.target?.result as ArrayBuffer)
        setHeaders(sheet.headers)
        setRows(sheet.rows)
        setColumnMap(autoMapColumns(sheet.headers))
        setStep("mapping")
      } catch (err) {
        toast.error(err instanceof ImportSheetError ? err.message : id.products.fileReadFailed)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleColumnMapChange = (colIdx: number, value: TargetFieldKey) => {
    setColumnMap((prev) => ({ ...prev, [colIdx]: value }))
  }

  // Memoised: the mapping footer shows the count on every render, and a price
  // list can hold ~10k rows.
  const mappedRows = useMemo(() => mapImportRows(rows, columnMap), [rows, columnMap])

  const handleImport = async () => {
    const { products, skippedRowNumbers } = mappedRows
    if (products.length === 0) {
      toast.error(id.products.importNothingValid)
      return
    }

    const importSession = session.current
    try {
      const res = withSkippedRows(await importMutation.mutateAsync(products), skippedRowNumbers)
      if (importSession !== session.current) {
        // The dialog moved on while the request ran; say how it went instead of
        // dropping the result into whatever the cashier is doing now.
        toast.success(
          id.products.importFinished(formatNumber(res.imported), formatNumber(res.updated)),
        )
        return
      }
      setResult(res)
      setStep("result")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : id.products.importFailed)
    }
  }

  const canImport = missingRequiredFields(columnMap).length === 0 && mappedRows.products.length > 0

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
      {/* `cover` hanya untuk langkah mapping: grid dua kolom + tabel preview
          butuh ukuran HeroUI yang memang untuk konten selebar layar, bukan
          `max-w-*` tulisan tangan. Langkah pilih file dan hasil cukup `lg` —
          di `cover` drop-zone-nya mengambang di atas layar kosong setinggi
          jendela. */}
      <Modal.Container size={step === "mapping" ? "cover" : "lg"}>
        <Modal.Dialog aria-label={id.products.importProducts}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-default text-foreground">
              <FileSpreadsheet className="size-5" />
            </Modal.Icon>
            <Modal.Heading>{id.products.importProducts}</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <p>
              {step === "upload" && "Pilih file CSV atau Excel berisi daftar produk."}
              {step === "mapping" &&
                `${formatNumber(rows.length)} baris ditemukan. Cocokkan tiap kolom file dengan data produk.`}
              {step === "result" && "Hasil import"}
            </p>

            {step === "upload" && <ImportUploadStep isReading={isReading} onFile={readFile} />}

            {step === "mapping" && (
              <ImportMappingStep
                columnMap={columnMap}
                headers={headers}
                rows={rows}
                onColumnMapChange={handleColumnMapChange}
              />
            )}

            {step === "result" && result && <ImportResultStep result={result} />}
          </Modal.Body>

          {step === "mapping" && (
            // `justify-between` disengaja: "Kembali" adalah langkah mundur wizard
            // dan berdiri di kiri, terpisah dari aksi utama di kanan.
            <Modal.Footer className="justify-between">
              <Button isDisabled={importMutation.isPending} variant="tertiary" onPress={resetState}>
                {id.common.back}
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted tabular-nums">
                  {formatNumber(mappedRows.products.length)} produk valid
                </span>
                <PendingButton
                  isDisabled={!canImport}
                  isPending={importMutation.isPending}
                  onPress={handleImport}
                >
                  {id.products.startImport}
                </PendingButton>
              </div>
            </Modal.Footer>
          )}

          {step === "result" && result && (
            <Modal.Footer>
              <Button variant="secondary" onPress={resetState}>
                Import Lagi
              </Button>
              <Button slot="close">Selesai</Button>
            </Modal.Footer>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
