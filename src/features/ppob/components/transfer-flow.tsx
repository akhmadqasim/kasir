import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { id } from "@/i18n/id"
import { useTransferChannels } from "../hooks"
import type { TransferChannelGroup, TransferChannelDetail } from "../types"

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`
}

export function TransferFlow() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [selectedChannel, setSelectedChannel] = useState<TransferChannelGroup | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<TransferChannelDetail | null>(null)
  const [accountNumber, setAccountNumber] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [senderName, setSenderName] = useState("")
  const [senderPhone, setSenderPhone] = useState("")

  const { data: channels, isLoading } = useTransferChannels()

  const filtered = useMemo(() => {
    if (!channels) return []
    if (!search) return channels
    const q = search.toLowerCase()
    return channels.filter((ch) => ch.channel.toLowerCase().includes(q))
  }, [channels, search])

  const amountNum = parseInt(amount, 10) || 0
  const fee = selectedDetail?.fee ?? 0
  const total = amountNum + fee

  const isFormValid =
    selectedChannel &&
    selectedDetail &&
    accountNumber.length >= 5 &&
    amountNum > 0 &&
    senderName.trim().length > 0 &&
    senderPhone.length >= 8

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.transfer}</h1>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* Bank Selection */}
          {!selectedChannel && (
            <>
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={id.ppob.searchBank}
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
                  {filtered.map((ch) => (
                    <Card
                      key={ch.channel}
                      className="cursor-pointer transition-colors hover:bg-accent"
                      onClick={() => {
                        setSelectedChannel(ch)
                        if (ch.details.length === 1) {
                          setSelectedDetail(ch.details[0])
                        }
                      }}
                    >
                      <CardContent className="py-4">
                        <p className="font-medium">{ch.channel}</p>
                        <p className="text-sm text-muted-foreground">
                          {ch.details.length} {ch.details.length === 1 ? "tipe" : "tipe"} transfer
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Channel Detail Selection (if multiple) */}
          {selectedChannel && !selectedDetail && selectedChannel.details.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{selectedChannel.channel}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedChannel.details.map((detail) => (
                  <Card
                    key={detail.channelId}
                    className="cursor-pointer transition-colors hover:bg-accent"
                    onClick={() => setSelectedDetail(detail)}
                  >
                    <CardContent className="py-3 flex justify-between items-center">
                      <span className="font-medium">{detail.transferType}</span>
                      <span className="text-sm text-muted-foreground">
                        {id.ppob.fee}: {formatRupiah(detail.fee)}
                      </span>
                    </CardContent>
                  </Card>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setSelectedChannel(null)
                    setSelectedDetail(null)
                  }}
                >
                  Ganti Bank
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Transfer Form */}
          {selectedChannel && selectedDetail && (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedChannel.channel}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedDetail.transferType} — {id.ppob.fee}: {formatRupiah(selectedDetail.fee)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedChannel(null)
                      setSelectedDetail(null)
                      setAccountNumber("")
                      setAmount("")
                      setDescription("")
                      setSenderName("")
                      setSenderPhone("")
                    }}
                  >
                    Ganti
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-base">{id.ppob.accountNumber}</Label>
                    <Input
                      type="text"
                      placeholder={id.ppob.accountNumberPlaceholder}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                      className="font-mono text-xl md:text-xl h-12"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base">{id.ppob.amount}</Label>
                    <Input
                      type="text"
                      placeholder={id.ppob.amountPlaceholder}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                      className="font-mono text-xl md:text-xl h-12"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{id.ppob.description}</Label>
                    <Input
                      type="text"
                      placeholder={id.ppob.descriptionPlaceholder}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{id.ppob.senderName}</Label>
                    <Input
                      type="text"
                      placeholder={id.ppob.senderNamePlaceholder}
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{id.ppob.senderPhone}</Label>
                    <Input
                      type="tel"
                      placeholder={id.ppob.senderPhonePlaceholder}
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value.replace(/\D/g, ""))}
                      className="font-mono"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedChannel && selectedDetail && isFormValid ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.selectBank}</span>
                    <span className="font-medium">{selectedChannel.channel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.accountNumber}</span>
                    <span className="font-mono text-base font-medium">{accountNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.amount}</span>
                    <span className="font-medium">{formatRupiah(amountNum)}</span>
                  </div>
                  {description && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{id.ppob.description}</span>
                      <span>{description}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.senderName}</span>
                    <span>{senderName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.senderPhone}</span>
                    <span className="font-mono text-base font-medium">{senderPhone}</span>
                  </div>
                  <div className="border-t pt-3 mt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{id.ppob.fee}</span>
                      <span>{formatRupiah(fee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground font-medium">{id.ppob.totalPayment}</span>
                      <span className="text-lg font-bold">{formatRupiah(total)}</span>
                    </div>
                  </div>
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : channels ? (
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
