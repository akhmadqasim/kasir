import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Save, Info } from "lucide-react"
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
      <CardHeader>
        <CardTitle>{id.settings.tabStore}</CardTitle>
        <CardDescription>
          {!isAdmin && (
            <span className="flex items-center gap-1.5 text-amber-600">
              <Info className="h-4 w-4" />
              {id.settings.storeInfoReadOnly}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="store-name">{id.settings.storeName} *</Label>
          <Input
            id="store-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="store-address">{id.settings.storeAddress}</Label>
          <Input
            id="store-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="store-phone">{id.settings.storePhone}</Label>
          <Input
            id="store-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="store-email">{id.settings.storeEmail}</Label>
          <Input
            id="store-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!isAdmin}
          />
        </div>

        {isAdmin && (
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isReady || !name.trim()}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
