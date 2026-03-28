import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { usePdamProducts } from "../hooks"
import type { PdamProduct } from "../types"

export function PdamFlow() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [selectedPdam, setSelectedPdam] = useState<PdamProduct | null>(null)
  const [customerId, setCustomerId] = useState("")

  const { data: pdams, isLoading } = usePdamProducts()

  const filtered = useMemo(() => {
    if (!pdams) return []
    if (!search) return pdams
    const q = search.toLowerCase()
    return pdams.filter(
      (p) =>
        p.merchant.toLowerCase().includes(q) ||
        p.igrDesc.toLowerCase().includes(q)
    )
  }, [pdams, search])

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.pdam}</h1>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* PDAM Selection */}
          {!selectedPdam && (
            <>
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={id.ppob.searchPdam}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {filtered.map((pdam) => (
                    <Card
                      key={pdam.id}
                      className="cursor-pointer transition-colors hover:bg-accent"
                      onClick={() => setSelectedPdam(pdam)}
                    >
                      <CardContent className="py-4">
                        <p className="font-medium">{pdam.merchant}</p>
                        <p className="text-sm text-muted-foreground">{pdam.igrDesc}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Customer ID Input */}
          {selectedPdam && (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedPdam.merchant}</p>
                    <p className="text-sm text-muted-foreground">{selectedPdam.igrDesc}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedPdam(null)
                      setCustomerId("")
                    }}
                  >
                    Ganti
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{id.ppob.customerId}</Label>
                  <Input
                    type="text"
                    placeholder={id.ppob.customerIdPlaceholder}
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, ""))}
                    className="max-w-sm font-mono text-xl md:text-xl h-12"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedPdam && customerId.length >= 8 ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.pdam}</span>
                    <span className="font-medium">{selectedPdam.merchant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.customerId}</span>
                    <span className="font-mono text-base font-medium">{customerId}</span>
                  </div>
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : pdams ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
