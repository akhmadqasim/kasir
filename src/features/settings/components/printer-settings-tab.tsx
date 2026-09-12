import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Save, TestTube } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Label,
  ListBox,
  Select,
  Separator,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react"

import { toast } from "@/lib/toast"
import { PendingButton } from "@/components/pending-button"
import { selectedText } from "@/components/selected-text"
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

  return (
    <Card>
      <Card.Header>
        <Card.Title>{id.settings.tabPrinter}</Card.Title>
        <Card.Description>
          Konfigurasi printer thermal untuk mencetak struk transaksi
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Printer Selection */}
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-2">
            <Select
              className="flex-1"
              placeholder={id.settings.noPrinterSelected}
              value={selectedPrinter || null}
              variant="secondary"
              onChange={(value) => setSelectedPrinter(value === null ? "" : String(value))}
            >
              <Label>{id.settings.selectPrinter}</Label>
              <Select.Trigger>
                <Select.Value>{selectedText}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {printers.length === 0 ? (
                    <ListBox.Item id="_none" isDisabled textValue="Tidak ada printer tersedia">
                      <Label>Tidak ada printer tersedia</Label>
                    </ListBox.Item>
                  ) : (
                    printers.map((p) => (
                      <ListBox.Item key={p.id} id={p.id} textValue={p.name}>
                        <Label>{p.name}</Label>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))
                  )}
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              aria-label="Muat ulang daftar printer"
              isDisabled={printersQuery.isFetching}
              isIconOnly
              variant="tertiary"
              onPress={() => queryClient.invalidateQueries({ queryKey: queryKeys.printers.list })}
            >
              <RefreshCw className={printersQuery.isFetching ? "animate-spin" : undefined} />
            </Button>
          </div>
          <Description>
            Pastikan printer thermal sudah terhubung dan terinstall di Windows
          </Description>
        </div>

        <Separator />

        {/* Paper Width */}
        <Select
          fullWidth
          value={paperWidth}
          variant="secondary"
          onChange={(value) => value !== null && setPaperWidth(String(value))}
        >
          <Label>{id.settings.paperWidth}</Label>
          <Select.Trigger>
            <Select.Value>{selectedText}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="58" textValue="58mm (32 karakter/baris)">
                <Label>58mm (32 karakter/baris)</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="80" textValue="80mm (42 karakter/baris)">
                <Label>80mm (42 karakter/baris)</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        <Separator />

        {/* Auto Print */}
        <Switch className="w-full" isSelected={autoPrint} onChange={setAutoPrint}>
          <Switch.Content className="w-full justify-between">
            {id.settings.autoPrint}
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
          <Description>{id.settings.autoPrintDesc}</Description>
        </Switch>

        <Separator />

        {/* Footer Text */}
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
