import { Alert, ScrollShadow, Table } from "@heroui/react"

import { OptionSelect } from "@/components/option-select"
import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { formatNumber } from "@/lib/format"
import {
  TARGET_FIELDS,
  mappedFieldCount,
  missingRequiredFields,
  targetFieldLabel,
  type ColumnMap,
  type TargetFieldKey,
} from "../import-mapping"

const PREVIEW_ROW_COUNT = 10

interface ImportMappingStepProps {
  headers: string[]
  rows: string[][]
  columnMap: ColumnMap
  onColumnMapChange: (colIdx: number, field: TargetFieldKey) => void
}

/** Step two of the import wizard: match each file column to a product field, with a preview. */
export function ImportMappingStep({
  headers,
  rows,
  columnMap,
  onColumnMapChange,
}: ImportMappingStepProps) {
  const missingFields = missingRequiredFields(columnMap)
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT)

  return (
    <>
      {/* Column Mapping */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground">{id.products.columnMapping}</p>
          <StatusBadge status="neutral" size="sm">
            {mappedFieldCount(columnMap)} kolom dipakai
          </StatusBadge>
        </div>
        <ScrollShadow className="max-h-64">
          <div className="grid gap-3 md:grid-cols-2">
            {headers.map((header, idx) => {
              const columnLabel = header || `Kolom ${idx + 1}`
              return (
                <div key={idx} className="flex items-center gap-2">
                  <span
                    className="w-32 shrink-0 truncate font-medium text-foreground sm:w-40"
                    title={columnLabel}
                  >
                    {columnLabel}
                  </span>
                  <OptionSelect
                    aria-label={`Field untuk ${columnLabel}`}
                    className="flex-1"
                    options={TARGET_FIELDS}
                    value={columnMap[idx] ?? "skip"}
                    variant="secondary"
                    onChange={(value) =>
                      onColumnMapChange(idx, (value ?? "skip") as TargetFieldKey)
                    }
                  />
                </div>
              )
            })}
          </div>
        </ScrollShadow>
      </div>

      {/* Tombol "Mulai Import" mati tanpa kedua kolom ini; pesannya
          menyebut keduanya supaya tombol mati itu tidak jadi teka-teki. */}
      {missingFields.length > 0 && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              Pilih kolom untuk {missingFields.join(" dan ")} sebelum mulai import.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* Preview Table */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <p className="font-medium text-foreground tabular-nums">
          Preview ({formatNumber(previewRows.length)} dari {formatNumber(rows.length)} baris)
        </p>
        <Table variant="secondary">
          <Table.ScrollContainer className="h-48">
            <Table.Content aria-label="Preview data import">
              <Table.Header>
                {headers.map((header, colIdx) => {
                  const fieldLabel = targetFieldLabel(columnMap[colIdx])
                  return (
                    <Table.Column
                      key={colIdx}
                      className="text-xs whitespace-nowrap"
                      id={String(colIdx)}
                      isRowHeader={colIdx === 0}
                    >
                      {fieldLabel ? (
                        <StatusBadge status="info" size="sm">
                          {fieldLabel}
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
  )
}
