import { invoke } from "@tauri-apps/api/core"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { BackupInfo } from "../types"

export const BACKUP_STATUS_QUERY_KEY = ["backup-status"] as const
export const BACKUP_LIST_QUERY_KEY = ["backup-list"] as const

export function useCreateBackupMutation() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  return useMutation({
    mutationFn: async () => {
      if (!user || user.role !== "admin") {
        throw new Error("Hanya admin yang dapat membuat backup")
      }

      return invoke<BackupInfo>("create_backup", { callerId: user.id })
    },
    onSuccess: (info) => {
      const size = info.size_bytes < 1024
        ? `${info.size_bytes} B`
        : info.size_bytes < 1024 * 1024
          ? `${(info.size_bytes / 1024).toFixed(1)} KB`
          : `${(info.size_bytes / (1024 * 1024)).toFixed(1)} MB`

      toast.success(`Backup berhasil: ${info.filename} (${size})`)
      queryClient.invalidateQueries({ queryKey: BACKUP_STATUS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: BACKUP_LIST_QUERY_KEY })
    },
    onError: (error) => toast.error(String(error)),
  })
}
