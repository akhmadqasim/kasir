import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
import { selectedText } from "@/components/selected-text"
import { id } from "@/i18n/id"
import type { PrinterSettings, PrinterInfo } from "../types"

export function PrinterSettingsTab() {
  const queryClient = useQueryClient()

  const [selectedPrinter, setSelectedPrinter] = useState<string>("")
  const [paperWidth, setPaperWidth] = useState<string>("58")
  const [autoPrint, setAutoPrint] = useState(false)
  const [footerText, setFooterText] = useState("")
  const [initialized, setInitialized] = useState(false)

  const printersQuery = useQuery<PrinterInfo[]>({
    queryKey: ["printers"],
    queryFn: () => invoke<PrinterInfo[]>("list_printers"),
  })

  const settingsQuery = useQuery<PrinterSettings>({
    queryKey: ["printer-settings"],
    queryFn: () => invoke<PrinterSettings>("get_printer_settings_cmd"),
  })

  if (settingsQuery.data && !initialized) {
    const s = settingsQuery.data
    if (s.printer_id) setSelectedPrinter(s.printer_id)
    if (s.paper_width) setPaperWidth(String(s.paper_width))
    if (s.auto_print !== null) setAutoPrint(s.auto_print ?? false)
    if (s.footer_text) setFooterText(s.footer_text)
    setInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: (input: {
      printer_id?: string
      paper_width?: number
      auto_print?: boolean
      footer_text?: string
    }) => invoke("update_printer_settings", { input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["printer-settings"] })
      toast.success(id.settings.printerSettingsSaved)
    },
    onError: (error) => {
      toast.error(String(error))
    },
  })

  const testPrintMutation = useMutation({
    mutationFn: () => invoke("test_print"),
    onSuccess: () => {
      toast.success(id.settings.testPrintSuccess)
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`${id.settings.testPrintFailed}: ${message}`)
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
      paper_width: Number(paperWidth) || undefined,
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
      <Card.Content className="space-y-6">
        {/* Printer Selection */}
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <Select
              className="flex-1"
              placeholder={id.settings.noPrinterSelected}
              value={selectedPrinter || null}
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
                    <ListBox.Item
                      id="_none"
                      isDisabled
                      textValue="Tidak ada printer tersedia"
                    >
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
              variant="outline"
              onPress={() => queryClient.invalidateQueries({ queryKey: ["printers"] })}
            >
              <RefreshCw
                className={`h-4 w-4 ${printersQuery.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <p className="text-xs text-muted">
            Pastikan printer thermal sudah terhubung dan terinstall di Windows
          </p>
        </div>

        <Separator />

        {/* Paper Width */}
        <Select
          fullWidth
          value={paperWidth}
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
            <span className="text-sm font-medium">{id.settings.autoPrint}</span>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
          <Description className="text-xs">{id.settings.autoPrintDesc}</Description>
        </Switch>

        <Separator />

        {/* Footer Text */}
        <TextField fullWidth value={footerText} onChange={setFooterText}>
          <Label>{id.settings.footerText}</Label>
          <TextArea placeholder={id.settings.footerTextPlaceholder} rows={3} />
        </TextField>

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            isDisabled={saveMutation.isPending || !isReady}
            onPress={handleSave}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button
            isDisabled={testPrintMutation.isPending || !selectedPrinter}
            variant="outline"
            onPress={() => testPrintMutation.mutate()}
          >
            <TestTube className="mr-2 h-4 w-4" />
            {testPrintMutation.isPending ? "Mengirim..." : id.settings.testPrint}
          </Button>
        </div>
      </Card.Content>
    </Card>
  )
}
