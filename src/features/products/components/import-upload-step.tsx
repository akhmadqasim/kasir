import { useState } from "react"
import { Download, Upload } from "lucide-react"
import { Button, Spinner } from "@heroui/react"

import { id } from "@/i18n/id"
import { toast } from "@/lib/toast"
import { downloadImportTemplate } from "@/lib/api/products"
import { cn } from "@/lib/utils"

/**
 * The template is now generated and served by the server, and arrives as an
 * ordinary browser download.
 *
 * The old command took the CSV text *and the filename* from this component and
 * wrote them to the user's Desktop — a path the webview chose, which stopped
 * being acceptable the moment the webview could be a tablet on the LAN. Nothing
 * on this side writes a file any more.
 */
async function downloadSampleTemplate() {
  try {
    await downloadImportTemplate()
    toast.success(id.products.templateDownloaded)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : id.products.templateDownloadFailed)
  }
}

interface ImportUploadStepProps {
  /** `true` while a picked file is being read; new files are refused meanwhile. */
  isReading: boolean
  onFile: (file: File) => void
}

/** Step one of the import wizard: pick or drop a CSV/Excel file. */
export function ImportUploadStep({ isReading, onFile }: ImportUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so picking the same file again (after fixing it in Excel) fires again.
    e.target.value = ""
    if (file) onFile(file)
  }

  // The drop zone used to only *look* like one: dropping a file on the label
  // did nothing, because a hidden input does not receive drops through its label.
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    // The input is disabled while a file is being read; a drop must wait too.
    if (file && !isReading) onFile(file)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Input filenya sengaja tetap HTML biasa: `<label>` yang
          membungkusnya sekaligus jadi nama aksesibel dan area drop.
          `border-dashed` dipertahankan — satu-satunya pengecualian
          DESIGN.md §5.7, karena ini drop-zone berkas sungguhan. */}
      {/* Input-nya `sr-only`, bukan `hidden`: `display: none` membuangnya
          dari urutan Tab, jadi pengguna keyboard tidak pernah bisa
          memilih file. Cincin fokusnya digambar di label lewat
          `has-[:focus-visible]`. */}
      <label
        aria-busy={isReading}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-accent hover:bg-default/50",
          "has-[:focus-visible]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
          isDragging && "border-accent bg-accent-soft",
        )}
        onDragLeave={(e) => {
          // dragleave also fires when the pointer moves onto a child
          // (the icon, the text); only a real exit ends the highlight.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDragging(false)
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDrop={handleDrop}
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-default text-foreground"
        >
          {isReading ? <Spinner size="sm" /> : <Upload className="size-6" />}
        </span>
        {/* `span`, bukan `div`/`p`: isi `<label>` harus phrasing content. */}
        <span className="flex flex-col">
          <span className="font-medium text-foreground">
            {isReading ? "Membaca file…" : "Klik untuk memilih file"}
          </span>
          {/* Dua baris, bukan satu kalimat bersambung "·": di dialog `lg`
              kalimat itu patah dan menyisakan "otomatis" sendirian. */}
          <span>
            atau seret file ke sini
            <span className="sr-only">, </span>
          </span>
          <span>.xlsx, .xls, .csv — kolom dideteksi otomatis</span>
        </span>
        <input
          type="file"
          className="sr-only"
          accept=".xlsx,.xls,.csv,.tsv"
          disabled={isReading}
          onChange={handleFileChange}
        />
      </label>
      <Button className="self-start" size="sm" variant="tertiary" onPress={downloadSampleTemplate}>
        <Download />
        Download contoh template
      </Button>
    </div>
  )
}
