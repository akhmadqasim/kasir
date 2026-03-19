import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Printer, TestTube, RefreshCw, Save } from "lucide-react"
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
import type { PrinterSettings, PrinterInfo } from "../types"

export function SettingsPage() {
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

  // Initialize form from saved settings
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
      toast.success("Pengaturan printer berhasil disimpan!")
    },
    onError: (error) => {
      toast.error(`Gagal menyimpan: ${error}`)
    },
  })

  const testPrintMutation = useMutation({
    mutationFn: () => invoke("test_print"),
    onSuccess: () => {
      toast.success("Test print berhasil dikirim!")
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Test print gagal: ${message}`)
    },
  })

  const handleSave = () => {
    saveMutation.mutate({
      printer_id: selectedPrinter || undefined,
      paper_width: Number(paperWidth) || undefined,
      auto_print: autoPrint,
      footer_text: footerText || undefined,
    })
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Pengaturan</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Printer Struk
          </CardTitle>
          <CardDescription>
            Konfigurasi printer thermal untuk mencetak struk transaksi
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Printer Selection */}
          <div className="space-y-2">
            <Label htmlFor="printer">Pilih Printer</Label>
            <div className="flex gap-2">
              <Select
                value={selectedPrinter}
                onValueChange={setSelectedPrinter}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Pilih printer..." />
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
            <Label htmlFor="paper-width">Lebar Kertas</Label>
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
              <Label>Auto Print</Label>
              <p className="text-xs text-muted-foreground">
                Cetak struk otomatis setelah transaksi selesai
              </p>
            </div>
            <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
          </div>

          <Separator />

          {/* Footer Text */}
          <div className="space-y-2">
            <Label htmlFor="footer-text">Teks Footer Struk</Label>
            <Textarea
              id="footer-text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Terima kasih!\nBarang yang sudah dibeli tidak dapat dikembalikan"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Kosongkan untuk menggunakan teks default
            </p>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
            <Button
              variant="outline"
              onClick={() => testPrintMutation.mutate()}
              disabled={
                testPrintMutation.isPending || !selectedPrinter
              }
            >
              <TestTube className="mr-2 h-4 w-4" />
              {testPrintMutation.isPending ? "Mengirim..." : "Test Print"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
