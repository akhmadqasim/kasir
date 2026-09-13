import { useRef, type ChangeEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Description, Fieldset } from "@heroui/react"
import { Trash2, Upload } from "lucide-react"

import { PendingButton } from "@/components/pending-button"
import { StoreLogo } from "@/components/store-logo"
import { id } from "@/i18n/id"
import { useApiMutation } from "@/hooks/use-api"
import { deleteStoreLogo, uploadStoreLogo } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/toast"
import type { StoreInfo } from "../types"

interface StoreLogoFieldProps {
  store: StoreInfo | null | undefined
  isAdmin: boolean
}

/**
 * The logo block in Info Toko: a preview drawn by the same `StoreLogo` the
 * sidebar uses, and — for an admin — the two actions that change it.
 *
 * The native file input is hidden behind a HeroUI button, as `import-dialog`
 * and the data tab already do: it cannot be styled to match, and the button
 * can. Every change invalidates the shared store query, so the sidebar picks
 * up the new logo without a reload.
 */
export function StoreLogoField({ store, isAdmin }: StoreLogoFieldProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const invalidateStore = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.store })

  const uploadMutation = useApiMutation<StoreInfo, File>(uploadStoreLogo, {
    onSuccess: () => {
      invalidateStore()
      toast.success(id.settings.storeLogoSaved)
    },
    onError: (error) => toast.error(error.message),
  })

  const removeMutation = useApiMutation<void, void>(deleteStoreLogo, {
    onSuccess: () => {
      invalidateStore()
      toast.success(id.settings.storeLogoRemoved)
    },
    onError: (error) => toast.error(error.message),
  })

  const handleFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so choosing the same file again still fires `change`.
    event.target.value = ""
    if (file) uploadMutation.mutate(file)
  }

  return (
    <Fieldset>
      <Fieldset.Legend>{id.settings.storeLogo}</Fieldset.Legend>
      <Description>{id.settings.storeLogoHint}</Description>
      {/* A plain row, not `Fieldset.Group`: that one stacks fields vertically
          (`space-y-4`, no flex), and here the preview sits beside its actions. */}
      <div className="flex items-center gap-4">
        <StoreLogo store={store} className="size-16" />
        {isAdmin && (
          <>
            <input
              ref={inputRef}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              aria-label={id.settings.storeLogoUpload}
              className="hidden"
              type="file"
              onChange={handleFileChosen}
            />
            <Fieldset.Actions className="flex-wrap pt-0">
              <PendingButton
                isPending={uploadMutation.isPending}
                variant="secondary"
                onPress={() => inputRef.current?.click()}
              >
                <Upload />
                {id.settings.storeLogoUpload}
              </PendingButton>
              {store?.logo_path && (
                <PendingButton
                  isPending={removeMutation.isPending}
                  variant="danger-soft"
                  onPress={() => removeMutation.mutate()}
                >
                  <Trash2 />
                  {id.settings.storeLogoRemove}
                </PendingButton>
              )}
            </Fieldset.Actions>
          </>
        )}
      </div>
    </Fieldset>
  )
}
