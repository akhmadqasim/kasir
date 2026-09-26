import { Alert, ScrollShadow } from "@heroui/react"

import { id } from "@/i18n/id"
import { InfoPanel } from "@/components/info-panel"
import { formatNumber } from "@/lib/format"
import type { BulkImportResult } from "../types"

/** Step three of the import wizard: what the server did with the rows. */
export function ImportResultStep({ result }: { result: BulkImportResult }) {
  const nothingImported = result.imported + result.updated === 0
  const hasProblems = result.errors.length > 0 || nothingImported

  return (
    <div className="flex flex-col gap-4">
      {/* Hijau hanya kalau memang bersih: import yang tidak memasukkan
          satu produk pun, atau yang membawa peringatan, bukan kabar baik. */}
      <Alert status={hasProblems ? "warning" : "success"}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {nothingImported ? id.products.importNothingImported : id.products.importDone}
          </Alert.Title>
          <Alert.Description className="tabular-nums">
            {formatNumber(result.imported)} ditambahkan, {formatNumber(result.updated)} diperbarui,{" "}
            {formatNumber(result.skipped)} dilewati
          </Alert.Description>
        </Alert.Content>
      </Alert>

      {result.errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-foreground tabular-nums">
            Peringatan ({formatNumber(result.errors.length)})
          </p>
          <ScrollShadow className="max-h-48">
            <InfoPanel>
              <ul aria-label="Daftar peringatan import" className="flex flex-col gap-1">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-foreground">
                    {err}
                  </li>
                ))}
              </ul>
            </InfoPanel>
          </ScrollShadow>
        </div>
      )}
    </div>
  )
}
