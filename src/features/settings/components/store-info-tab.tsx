import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Save, Info, StoreIcon } from "lucide-react"
import { Card, FieldError, Input, Label, TextField } from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { toast } from "@/lib/toast"
import { LoadError } from "@/components/load-error"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { useApiMutation } from "@/hooks/use-api"
import { useStoreInfo } from "../hooks/use-store-info"
import { updateStoreInfo } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import type { StoreInfo } from "../types"
import { StoreLogoField } from "./store-logo-field"

/** Loose on purpose: it only catches typos ("toko@gmail", "toko.gmail.com"). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function StoreInfoTab({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [initialized, setInitialized] = useState(false)
  // Errors appear after the first save attempt, not while the address is still
  // half typed.
  const [showErrors, setShowErrors] = useState(false)

  const storeQuery = useStoreInfo()

  if (storeQuery.data && !initialized) {
    const s = storeQuery.data
    setName(s.name)
    setAddress(s.address ?? "")
    setPhone(s.phone ?? "")
    setEmail(s.email ?? "")
    setInitialized(true)
  }

  // Saving before the query resolves would post the empty initial state over the
  // stored store info. `isSuccess` alone is the right gate here: the query legitimately
  // resolves to null on a store that has no info yet, and saving then is a create.
  const isReady = storeQuery.isSuccess
  // Typing into the fields before the data lands would be overwritten by it, so
  // they stay locked until then.
  const isEditable = isAdmin && isReady

  const nameError = name.trim() ? null : id.validation.storeNameRequired
  const emailError =
    email.trim() && !EMAIL_PATTERN.test(email.trim()) ? id.validation.invalidEmail : null

  const saveMutation = useApiMutation<StoreInfo, void>(
    () => {
      if (!isReady) {
        return Promise.reject(new Error(id.notLoaded.storeInfo))
      }
      return updateStoreInfo({
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      })
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.store })
        toast.success(id.settings.storeInfoSaved)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    },
  )

  const handleSave = () => {
    setShowErrors(true)
    if (nameError || emailError) return
    saveMutation.mutate(undefined)
  }

  if (storeQuery.isError) {
    return (
      <Card>
        <LoadError
          icon={<StoreIcon />}
          isRetrying={storeQuery.isFetching}
          title={id.loadFailed.storeInfo}
          onRetry={() => void storeQuery.refetch()}
        >
          {storeQuery.error.message}
        </LoadError>
      </Card>
    )
  }

  return (
    <Card>
      <Card.Header>
        <CardHeading>{id.settings.tabStore}</CardHeading>
        <Card.Description>
          Nama, alamat, dan kontak ini dicetak di kepala setiap struk.
        </Card.Description>
        {!isAdmin && (
          <Card.Description className="flex items-center gap-1.5 text-warning">
            <Info aria-hidden="true" className="size-4 shrink-0" />
            {id.settings.storeInfoReadOnly}
          </Card.Description>
        )}
      </Card.Header>
      <Card.Content className="gap-4">
        <StoreLogoField isAdmin={isAdmin} store={storeQuery.data} />

        {/* `isRequired` replaces the old `required` attribute: HeroUI's Label draws the
            asterisk itself, so the marker no longer has to be typed into the string. */}
        <TextField
          fullWidth
          isDisabled={!isEditable}
          isInvalid={showErrors && nameError !== null}
          isRequired
          value={name}
          variant="secondary"
          onChange={setName}
        >
          <Label>{id.settings.storeName}</Label>
          <Input />
          <FieldError>{nameError}</FieldError>
        </TextField>

        <TextField
          fullWidth
          isDisabled={!isEditable}
          value={address}
          variant="secondary"
          onChange={setAddress}
        >
          <Label>{id.settings.storeAddress}</Label>
          <Input />
        </TextField>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            fullWidth
            isDisabled={!isEditable}
            type="tel"
            value={phone}
            variant="secondary"
            onChange={setPhone}
          >
            <Label>{id.settings.storePhone}</Label>
            <Input inputMode="tel" />
          </TextField>

          <TextField
            fullWidth
            isDisabled={!isEditable}
            isInvalid={showErrors && emailError !== null}
            type="email"
            value={email}
            variant="secondary"
            onChange={setEmail}
          >
            <Label>{id.settings.storeEmail}</Label>
            <Input inputMode="email" />
            <FieldError>{emailError}</FieldError>
          </TextField>
        </div>
      </Card.Content>
      {isAdmin && (
        <Card.Footer>
          <PendingButton
            isDisabled={!isReady}
            isPending={saveMutation.isPending}
            onPress={handleSave}
          >
            <Save />
            {id.common.save}
          </PendingButton>
        </Card.Footer>
      )}
    </Card>
  )
}
