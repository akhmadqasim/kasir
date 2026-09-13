import { useQueryClient } from "@tanstack/react-query"

import { useApiMutation } from "@/hooks/use-api"
import { createBackup } from "@/lib/api/backups"
import { queryKeys } from "@/lib/api/query-keys"
import { formatFileSize } from "@/lib/format"
import { toast } from "@/lib/toast"
import type { BackupInfo } from "../types"

/**
 * Take a backup now.
 *
 * The role check that used to live here is gone: `POST /api/backups` is behind
 * `require_admin`, so a cashier gets a 403 with a message written for them
 * rather than a client-side guess at what the server would have said.
 */
export function useCreateBackupMutation() {
  const queryClient = useQueryClient()

  return useApiMutation<BackupInfo, void>(createBackup, {
    onSuccess: (info) => {
      toast.success(`Backup berhasil: ${info.filename} (${formatFileSize(info.size_bytes)})`)
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
    },
    onError: (error) => toast.error(error.message),
  })
}
