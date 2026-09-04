import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCw, Save, TestTube } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{id.settings.tabPrinter}</CardTitle>
        <CardDescription>
          Konfigurasi printer thermal untuk mencetak struk transaksi
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Printer Selection */}
        <div className="space-y-2">
          <Label htmlFor="printer">{id.settings.selectPrinter}</Label>
          <div className="flex gap-2">
            <Select
              value={selectedPrinter}
              onValueChange={setSelectedPrinter}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={id.settings.noPrinterSelected} />
              </SelectTrigger>
              <SelectContent>
                {printersQuery.data?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                {printersQuery.data?.length === 0 && (
                  <SelectItem value="_none" disabled>
                    Tidak ada printer tersedia
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["printers"] })
              }
              disabled={printersQuery.isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 ${printersQuery.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Pastikan printer thermal sudah terhubung dan terinstall di Windows
          </p>
        </div>

        <Separator />

        {/* Paper Width */}
        <div className="space-y-2">
          <Label htmlFor="paper-width">{id.settings.paperWidth}</Label>
          <Select value={paperWidth} onValueChange={setPaperWidth}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="58">58mm (32 karakter/baris)</SelectItem>
              <SelectItem value="80">80mm (42 karakter/baris)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Auto Print */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{id.settings.autoPrint}</Label>
            <p className="text-xs text-muted-foreground">
              {id.settings.autoPrintDesc}
            </p>
          </div>
          <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
        </div>

        <Separator />

        {/* Footer Text */}
        <div className="space-y-2">
          <Label htmlFor="footer-text">{id.settings.footerText}</Label>
          <Textarea
            id="footer-text"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder={id.settings.footerTextPlaceholder}
            rows={3}
          />
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saveMutation.isPending || !isReady}>
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button
            variant="outline"
            onClick={() => testPrintMutation.mutate()}
            disabled={testPrintMutation.isPending || !selectedPrinter}
          >
            <TestTube className="mr-2 h-4 w-4" />
            {testPrintMutation.isPending ? "Mengirim..." : id.settings.testPrint}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
