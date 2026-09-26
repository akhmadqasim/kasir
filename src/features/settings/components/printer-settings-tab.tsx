import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Info, RefreshCw, Save, TestTube } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Label,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { toast } from "@/lib/toast"
import { LoadError } from "@/components/load-error"
import { OptionSelect } from "@/components/option-select"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { useApiMutation, useApiQuery } from "@/hooks/use-api"
import {
  getPrinterSettings,
  listPrinters,
  testPrint,
  updatePrinterSettings,
} from "@/lib/api/printers"
import { queryKeys } from "@/lib/api/query-keys"
import type { PrinterSettings, PrinterInfo } from "../types"

const PAPER_WIDTHS = [
  { key: "58", label: "58mm (32 karakter/baris)" },
  { key: "80", label: "80mm (42 karakter/baris)" },
]

// Teks adalah bawaannya: font printer sendiri, persis cara aplikasi Mitra
// Indogrosir mencetak struknya di printer yang sama, dan datanya kecil sehingga
// cepat. Gambar menggambar struk dengan satu font mesin tik lalu mengirim
// gambarnya — seragam, tapi lebih lambat dan hanya jalan di Windows.
const PRINT_MODES = [
  { key: "text", label: "Teks (font printer)" },
  { key: "raster", label: "Gambar (font mesin tik)" },
]

// Matches the comment above: the Mitra app prints text, so "Teks" is the one
// that looks like its struk.
const PRINT_MODE_DESCRIPTION =
  "Teks: font bawaan printer, paling cepat — seperti struk Mitra. Gambar: huruf seragam, tapi lebih lambat dan hanya di Windows."

/**
 * Saving is admin-only on the server (`PUT /printers/settings`), so a kasir gets
 * the tab read-only — but keeps Test Print, which any role may run.
 */
export function PrinterSettingsTab({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()

  const [selectedPrinter, setSelectedPrinter] = useState<string>("")
  const [paperWidth, setPaperWidth] = useState<string>("58")
  const [autoPrint, setAutoPrint] = useState(false)
  const [footerText, setFooterText] = useState("")
  const [printMode, setPrintMode] = useState<string>("text")
  const [initialized, setInitialized] = useState(false)

  // Printers are the ones the *till's* operating system can see: the server
  // enumerates them, because that is where the paper comes out.
  const printersQuery = useApiQuery<PrinterInfo[]>(queryKeys.printers.list, listPrinters)

  const settingsQuery = useApiQuery<PrinterSettings>(
    queryKeys.printers.settings,
    getPrinterSettings,
  )

  if (settingsQuery.data && !initialized) {
    const s = settingsQuery.data
    if (s.printer_id) setSelectedPrinter(s.printer_id)
    if (s.paper_width) setPaperWidth(String(s.paper_width))
    if (s.auto_print !== null) setAutoPrint(s.auto_print ?? false)
    if (s.footer_text) setFooterText(s.footer_text)
    if (s.print_mode) setPrintMode(s.print_mode)
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, PrinterSettings>(updatePrinterSettings, {
    onSuccess: (_data, saved) => {
      // Written straight into the cache so Test Print (which compares against
      // the saved printer) turns on at once instead of after the refetch.
      queryClient.setQueryData(queryKeys.printers.settings, saved)
      queryClient.invalidateQueries({ queryKey: queryKeys.printers.settings })
      toast.success(id.settings.printerSettingsSaved)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const testPrintMutation = useApiMutation<void, void>(testPrint, {
    onSuccess: () => {
      toast.success(id.settings.testPrintSuccess)
    },
    onError: (error) => {
      toast.error(`${id.settings.testPrintFailed}: ${error.message}`)
    },
  })

  // Saving before the query resolves would write the hardcoded defaults over the
  // stored settings, so the button stays disabled until the form holds real data.
  const isReady = settingsQuery.isSuccess && initialized
  // Fields stay locked until the stored values are in, so nothing typed early
  // is overwritten by them.
  const isEditable = isAdmin && isReady

  const handleSave = () => {
    if (!isReady) return
    // Send the raw strings: `|| undefined` would drop the key from the JSON and the
    // Rust `if let Some(...)` would keep the old value, making the field unclearable.
    saveMutation.mutate({
      printer_id: selectedPrinter,
      paper_width: Number(paperWidth) || null,
      auto_print: autoPrint,
      footer_text: footerText,
      print_mode: printMode,
    })
  }

  // The server prints with the *saved* printer, so testing an unsaved pick would
  // come out on the old one (or fail) and make the new one look broken.
  const savedPrinter = settingsQuery.data?.printer_id ?? ""
  const canTestPrint = savedPrinter !== "" && selectedPrinter === savedPrinter

  const printers = printersQuery.data ?? []
  const printerOptions = printers.map((printer) => ({ key: printer.id, label: printer.name }))
  // A saved printer that is unplugged (or renamed in Windows) is not in the
  // list; without its own option the field showed "Tidak ada printer" while the
  // setting still pointed at it.
  if (selectedPrinter && !printerOptions.some((option) => option.key === selectedPrinter)) {
    printerOptions.unshift({
      key: selectedPrinter,
      label: printersQuery.isSuccess
        ? id.settings.printerNotDetected(selectedPrinter)
        : selectedPrinter,
    })
  }

  const printerPlaceholder = printersQuery.isPending
    ? id.settings.searchingPrinters
    : printerOptions.length === 0
      ? id.settings.noPrintersAvailable
      : id.settings.noPrinterSelected

  const testPrintHint = canTestPrint
    ? null
    : !isAdmin
      ? id.settings.testPrintNoPrinter
      : savedPrinter === ""
        ? id.settings.testPrintSaveFirst
        : id.settings.testPrintSaveNewFirst

  if (settingsQuery.isError) {
    return (
      <Card>
        <LoadError
          isRetrying={settingsQuery.isFetching}
          title={id.loadFailed.printerSettings}
          onRetry={() => void settingsQuery.refetch()}
        >
          {settingsQuery.error.message}
        </LoadError>
      </Card>
    )
  }

  return (
    <Card>
      {/* Tombol muat-ulang daftar printer duduk di kanan kepala kartu, bukan
          menempel di samping kolom pilihannya: kolom itu punya `Description` di
          bawahnya, dan tombol yang disejajarkan ke dasar kolom akan turun ikut
          keterangannya. */}
      <Card.Header className="flex-row items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardHeading>{id.settings.tabPrinter}</CardHeading>
          {!isAdmin && (
            <Card.Description className="flex items-center gap-1.5 text-warning">
              <Info aria-hidden="true" className="size-4 shrink-0" />
              Hanya admin yang dapat mengubah pengaturan printer
            </Card.Description>
          )}
        </div>
        <Button
          aria-label={id.reloadLabel.printers}
          isIconOnly
          isPending={printersQuery.isFetching}
          size="sm"
          variant="tertiary"
          onPress={() => queryClient.invalidateQueries({ queryKey: queryKeys.printers.list })}
        >
          {({ isPending }) => (isPending ? <Spinner color="current" size="sm" /> : <RefreshCw />)}
        </Button>
      </Card.Header>
      <Card.Content className="gap-6">
        <OptionSelect
          fullWidth
          errorMessage={
            printersQuery.isError
              ? `${id.loadFailed.printers}: ${printersQuery.error.message}`
              : undefined
          }
          isDisabled={!isEditable || printerOptions.length === 0}
          label={id.settings.selectPrinter}
          options={printerOptions}
          placeholder={printerPlaceholder}
          value={selectedPrinter || null}
          variant="secondary"
          description="Pastikan printer thermal sudah terhubung dan terpasang di Windows"
          onChange={(value) => setSelectedPrinter(value ?? "")}
        />

        <OptionSelect
          fullWidth
          isDisabled={!isEditable}
          label={id.settings.paperWidth}
          options={PAPER_WIDTHS}
          value={paperWidth}
          variant="secondary"
          onChange={(value) => value !== null && setPaperWidth(value)}
        />

        <OptionSelect
          fullWidth
          description={PRINT_MODE_DESCRIPTION}
          isDisabled={!isEditable}
          label="Mode cetak"
          options={PRINT_MODES}
          value={printMode}
          variant="secondary"
          onChange={(value) => value !== null && setPrintMode(value)}
        />

        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. */}
        <Switch isDisabled={!isEditable} isSelected={autoPrint} onChange={setAutoPrint}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {id.settings.autoPrint}
          </Switch.Content>
          <Description>{id.settings.autoPrintDesc}</Description>
        </Switch>

        <TextField
          fullWidth
          isDisabled={!isEditable}
          value={footerText}
          variant="secondary"
          onChange={setFooterText}
        >
          <Label>{id.settings.footerText}</Label>
          <TextArea placeholder={id.settings.footerTextPlaceholder} rows={3} />
        </TextField>
      </Card.Content>
      <Card.Footer className="flex-wrap items-center gap-2">
        {isAdmin && (
          <PendingButton
            isDisabled={!isReady}
            isPending={saveMutation.isPending}
            onPress={handleSave}
          >
            <Save />
            {id.common.save}
          </PendingButton>
        )}
        <PendingButton
          isDisabled={!canTestPrint}
          isPending={testPrintMutation.isPending}
          variant="secondary"
          onPress={() => testPrintMutation.mutate(undefined)}
        >
          <TestTube />
          {id.settings.testPrint}
        </PendingButton>
        {/* Says why Test Print is off instead of leaving a dead button. */}
        {testPrintHint && isReady && <p className="text-sm text-muted">{testPrintHint}</p>}
      </Card.Footer>
    </Card>
  )
}
