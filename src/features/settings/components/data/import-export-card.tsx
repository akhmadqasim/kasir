import { useRef, useState, type ChangeEvent } from "react"
import { Download, Upload } from "lucide-react"
import { AlertDialog, Button, Card, Separator } from "@heroui/react"

import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { errorMessage } from "@/lib/api/client"
import { exportDatabase, importDatabase } from "@/lib/api/backups"
import { formatFileSize } from "@/lib/format"
import { toast } from "@/lib/toast"

/*
 * Export and import used to go through the Tauri file dialog, which handed the
 * backend a path the client had chosen. That was already a path traversal
 * waiting to happen, and it stopped being possible at all once the client can be
 * a browser on another machine — the till's filesystem is not the tablet's.
 *
 * Both are now ordinary web transfers. Export is a download: the server
 * checkpoints the WAL, streams `kasir.db`, and names it in `Content-Disposition`
 * for the browser's download folder. Import is a `<input type="file">` and a
 * multipart upload whose filename the server ignores entirely.
 */

/**
 * Memindahkan seluruh database keluar-masuk toko lewat berkas.
 *
 * Kedua aksi digabung satu kartu (bukan dua yang identik strukturnya) karena
 * keduanya menjawab pertanyaan yang sama — "bagaimana database berpindah
 * komputer" — hanya arahnya yang berbeda. Export cuma mengunduh (`secondary`),
 * import menimpa seluruh database sehingga dikonfirmasi lewat `AlertDialog`
 * seperti pulih backup; tidak ada tombol primary di kartu ini karena
 * "Backup Sekarang" di kartu Database sudah memegang peran itu untuk tab ini.
 */
export function ImportExportCard() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  /** The chosen upload, held between picking the file and confirming the import. */
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  /** Stream the live database to the browser's download folder. */
  const handleExport = async () => {
    setIsExporting(true)
    try {
      const filename = await exportDatabase()
      toast.success(`${id.settings.exportSuccess}: ${filename}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsExporting(false)
    }
  }

  /**
   * Picking a file does not import it. The file is held until the confirmation
   * dialog is answered, because this replaces the whole shop's database.
   */
  const handleImportFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    // Reset the input so choosing the same file twice still fires `change`.
    event.target.value = ""
    if (file) setPendingImportFile(file)
  }

  const handleImportConfirmed = async () => {
    const file = pendingImportFile
    setPendingImportFile(null)
    if (!file) return

    setIsImporting(true)
    try {
      const message = await importDatabase(file)
      toast.success(message || id.settings.importSuccess)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Ekspor & Impor Database</Card.Title>
        <Card.Description>
          Pindahkan database ke komputer lain lewat berkas, atau pasang database dari berkas backup
          — dipakai saat ganti komputer atau instalasi ulang aplikasi.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Berkas database diunduh oleh browser ini, masuk ke folder unduhan PC kasir.
          </p>
          <PendingButton isPending={isExporting} variant="secondary" onPress={handleExport}>
            <Download />
            {id.settings.exportDatabase}
          </PendingButton>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Pilih berkas <code>.db</code> hasil export. Database saat ini akan digantikan sepenuhnya
            saat aplikasi dijalankan berikutnya.
          </p>
          <PendingButton
            isPending={isImporting}
            variant="secondary"
            onPress={() => importInputRef.current?.click()}
          >
            <Upload />
            {id.settings.importDatabase}
          </PendingButton>
          {/* Hidden on purpose: the native file input cannot be styled to match
              the rest of the screen, and the button above opens it. */}
          <input
            ref={importInputRef}
            accept=".db,application/vnd.sqlite3,application/x-sqlite3"
            className="hidden"
            onChange={handleImportFileChosen}
            type="file"
          />
        </div>
      </Card.Content>

      {/* Opens once a file has been picked, not when the button is pressed: the
          name of the file being installed is the thing worth confirming. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={pendingImportFile !== null}
        onOpenChange={(open) => !open && setPendingImportFile(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.settings.importDatabase}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.settings.importDatabase}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.settings.importConfirm}</p>
              {pendingImportFile && (
                <p className="font-medium">
                  {pendingImportFile.name} ({formatFileSize(pendingImportFile.size)})
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                Batal
              </Button>
              <Button variant="danger" onPress={() => void handleImportConfirmed()}>
                Ya, Import
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </Card>
  )
}
