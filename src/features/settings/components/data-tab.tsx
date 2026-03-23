import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery } from "@tanstack/react-query"
import { Download, Upload, HardDrive } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { id } from "@/i18n/id"
import type { DatabaseInfo } from "../types"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DataTab() {
  const [exportPath, setExportPath] = useState("")
  const [importPath, setImportPath] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const dbInfoQuery = useQuery<DatabaseInfo>({
    queryKey: ["database-info"],
    queryFn: () => invoke<DatabaseInfo>("get_database_info"),
  })

  const handleExportWithDialog= async () => {
    setIsExporting(true)
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const selected = await save({
        defaultPath: "kasir-backup.db",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      })
      if (!selected) {
        setIsExporting(false)
        return
      }
      await invoke<number>("export_database", { exportPath: selected })
      toast.success(id.settings.exportSuccess)
    } catch {
      // Dialog not available, fall back to text input
      if (!exportPath.trim()) {
        toast.error("Masukkan lokasi file export")
        setIsExporting(false)
        return
      }
      try {
        await invoke<number>("export_database", { exportPath: exportPath.trim() })
        toast.success(id.settings.exportSuccess)
      } catch (error) {
        toast.error(String(error))
      }
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportWithDialog = async () => {
    setIsImporting(true)
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      })
      if (!selected) {
        setIsImporting(false)
        return
      }
      const filePath = typeof selected === "string" ? selected : selected.path
      await invoke<string>("import_database", { importPath: filePath })
      toast.success(id.settings.importSuccess)
    } catch {
      // Dialog not available, fall back to text input
      if (!importPath.trim()) {
        toast.error("Masukkan lokasi file backup")
        setIsImporting(false)
        return
      }
      try {
        await invoke<string>("import_database", { importPath: importPath.trim() })
        toast.success(id.settings.importSuccess)
      } catch (error) {
        toast.error(String(error))
      }
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Database Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Database
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {id.settings.databaseSize}
            </span>
            <span className="font-medium">
              {dbInfoQuery.data
                ? formatFileSize(dbInfoQuery.data.size_bytes)
                : "—"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {id.settings.databasePath}
            </span>
            <span className="font-mono text-xs max-w-[300px] truncate">
              {dbInfoQuery.data?.path ?? "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle>{id.settings.exportDatabase}</CardTitle>
          <CardDescription>{id.settings.exportDatabaseDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-path">Lokasi File (fallback)</Label>
            <Input
              id="export-path"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              placeholder="C:\backup\kasir-backup.db"
            />
          </div>
          <Button
            onClick={handleExportWithDialog}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Mengexport..." : id.settings.exportDatabase}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle>{id.settings.importDatabase}</CardTitle>
          <CardDescription>{id.settings.importDatabaseDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-path">Lokasi File Backup (fallback)</Label>
            <Input
              id="import-path"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="C:\backup\kasir-backup.db"
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isImporting}>
                <Upload className="mr-2 h-4 w-4" />
                {isImporting ? "Mengimport..." : id.settings.importDatabase}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{id.settings.importDatabase}</AlertDialogTitle>
                <AlertDialogDescription>
                  {id.settings.importConfirm}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={handleImportWithDialog}>
                  Ya, Import
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
