import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Save, TestTube } from "lucide-react"
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

import { toast } from "@/lib/toast"
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

export function PrinterSettingsTab() {
  const queryClient = useQueryClient()

  const [selectedPrinter, setSelectedPrinter] = useState<string>("")
  const [paperWidth, setPaperWidth] = useState<string>("58")
  const [autoPrint, setAutoPrint] = useState(false)
  const [footerText, setFooterText] = useState("")
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
    setInitialized(true)
  }

  const saveMutation = useApiMutation<void, PrinterSettings>(updatePrinterSettings, {
    onSuccess: () => {
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

  const handleSave = () => {
    if (!isReady) return
    // Send the raw strings: `|| undefined` would drop the key from the JSON and the
    // Rust `if let Some(...)` would keep the old value, making the field unclearable.
    saveMutation.mutate({
      printer_id: selectedPrinter,
      paper_width: Number(paperWidth) || null,
      auto_print: autoPrint,
      footer_text: footerText,
    })
  }

  const printers = printersQuery.data ?? []
  const printerOptions = printers.map((printer) => ({ key: printer.id, label: printer.name }))

  return (
    <Card>
      {/* Tombol muat-ulang daftar printer duduk di kanan kepala kartu, bukan
          menempel di samping kolom pilihannya: kolom itu punya `Description` di
          bawahnya, dan tombol yang disejajarkan ke dasar kolom akan turun ikut
          keterangannya. */}
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title>{id.settings.tabPrinter}</Card.Title>
        <Button
          aria-label="Muat ulang daftar printer"
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
          isDisabled={printerOptions.length === 0}
          label={id.settings.selectPrinter}
          options={printerOptions}
          placeholder={
            printerOptions.length === 0
              ? "Tidak ada printer tersedia"
              : id.settings.noPrinterSelected
          }
          value={selectedPrinter || null}
          variant="secondary"
          description="Pastikan printer thermal sudah terhubung dan terinstall di Windows"
          onChange={(value) => setSelectedPrinter(value ?? "")}
        />

        <OptionSelect
          fullWidth
          label={id.settings.paperWidth}
          options={PAPER_WIDTHS}
          value={paperWidth}
          variant="secondary"
          onChange={(value) => value !== null && setPaperWidth(value)}
        />

        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. */}
        <Switch isSelected={autoPrint} onChange={setAutoPrint}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {id.settings.autoPrint}
          </Switch.Content>
          <Description>{id.settings.autoPrintDesc}</Description>
        </Switch>

        <TextField fullWidth value={footerText} variant="secondary" onChange={setFooterText}>
          <Label>{id.settings.footerText}</Label>
          <TextArea placeholder={id.settings.footerTextPlaceholder} rows={3} />
        </TextField>
      </Card.Content>
      <Card.Footer className="gap-2">
        <PendingButton
          isDisabled={!isReady}
          isPending={saveMutation.isPending}
          onPress={handleSave}
        >
          <Save />
          Simpan
        </PendingButton>
        <PendingButton
          isDisabled={!selectedPrinter}
          isPending={testPrintMutation.isPending}
          variant="secondary"
          onPress={() => testPrintMutation.mutate(undefined)}
        >
          <TestTube />
          {id.settings.testPrint}
        </PendingButton>
      </Card.Footer>
    </Card>
  )
}
