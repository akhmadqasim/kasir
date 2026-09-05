import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save, Info } from "lucide-react"
import { Button, Card, Input, Label, TextField } from "@heroui/react"

import { toast } from "@/lib/toast"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { StoreInfo } from "../types"

export function StoreInfoTab({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [initialized, setInitialized] = useState(false)

  const storeQuery = useQuery<StoreInfo | null>({
    queryKey: ["store-info"],
    queryFn: () => invoke<StoreInfo | null>("get_store_info"),
  })

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

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!isReady) {
        throw new Error("Informasi toko belum dimuat, coba lagi sebentar")
      }
      return invoke("update_store_info", {
        name,
        address: address || null,
        phone: phone || null,
        email: email || null,
        callerId: user!.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-info"] })
      toast.success(id.settings.storeInfoSaved)
    },
    onError: (error) => {
      toast.error(String(error))
    },
  })

  return (
    <Card>
      <Card.Header>
        <Card.Title>{id.settings.tabStore}</Card.Title>
        {!isAdmin && (
          <Card.Description>
            <span className="flex items-center gap-1.5 text-warning">
              <Info className="h-4 w-4" />
              {id.settings.storeInfoReadOnly}
            </span>
          </Card.Description>
        )}
      </Card.Header>
      <Card.Content className="space-y-4">
        {/* `isRequired` replaces the old `required` attribute: HeroUI's Label draws the
            asterisk itself, so the marker no longer has to be typed into the string. */}
        <TextField
          fullWidth
          isDisabled={!isAdmin}
          isRequired
          value={name}
          onChange={setName}
        >
          <Label>{id.settings.storeName}</Label>
          <Input />
        </TextField>

        <TextField fullWidth isDisabled={!isAdmin} value={address} onChange={setAddress}>
          <Label>{id.settings.storeAddress}</Label>
          <Input />
        </TextField>

        <TextField fullWidth isDisabled={!isAdmin} value={phone} onChange={setPhone}>
          <Label>{id.settings.storePhone}</Label>
          <Input />
        </TextField>

        <TextField
          fullWidth
          isDisabled={!isAdmin}
          type="email"
          value={email}
          onChange={setEmail}
        >
          <Label>{id.settings.storeEmail}</Label>
          <Input />
        </TextField>

        {isAdmin && (
          <Button
            isDisabled={saveMutation.isPending || !isReady || !name.trim()}
            onPress={() => saveMutation.mutate()}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        )}
      </Card.Content>
    </Card>
  )
}
