import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card, Input, Label, SearchField, Skeleton, TextField } from "@heroui/react"
import { ArrowLeft } from "lucide-react"

import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { useTransferChannels } from "../hooks"
import type { TransferChannelGroup, TransferChannelDetail } from "../types"

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

  const resetChannel = () => {
    setSelectedChannel(null)
    setSelectedDetail(null)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button
          aria-label={id.common.back}
          isIconOnly
          variant="ghost"
          onPress={() => navigate("/ppob")}
        >
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
              <SearchField
                aria-label={id.ppob.searchBank}
                className="max-w-sm"
                value={search}
                onChange={setSearch}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={id.ppob.searchBank} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : (
                <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {filtered.map((ch) => (
                    <Button
                      key={ch.channel}
                      className="h-auto w-full flex-col items-start gap-0.5 px-4 py-4 text-left"
                      variant="outline"
                      onPress={() => {
                        setSelectedChannel(ch)
                        if (ch.details.length === 1) {
                          setSelectedDetail(ch.details[0])
                        }
                      }}
                    >
                      <span className="font-medium">{ch.channel}</span>
                      <span className="text-sm text-muted">
                        {ch.details.length} tipe transfer
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Channel Detail Selection (if multiple) */}
          {selectedChannel && !selectedDetail && selectedChannel.details.length > 1 && (
            <Card>
              <Card.Header>
                <Card.Title className="text-lg">{selectedChannel.channel}</Card.Title>
              </Card.Header>
              <Card.Content className="space-y-2">
                {selectedChannel.details.map((detail) => (
                  <Button
                    key={detail.channelId}
                    className="h-auto w-full justify-between px-4 py-3"
                    variant="outline"
                    onPress={() => setSelectedDetail(detail)}
                  >
                    <span className="font-medium">{detail.transferType}</span>
                    <span className="text-sm text-muted">
                      {id.ppob.fee}: {formatRupiah(detail.fee)}
                    </span>
                  </Button>
                ))}
                <Button className="mt-2" size="sm" variant="outline" onPress={resetChannel}>
                  Ganti Bank
                </Button>
              </Card.Content>
            </Card>
          )}

          {/* Transfer Form */}
          {selectedChannel && selectedDetail && (
            <Card>
              <Card.Content className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedChannel.channel}</p>
                    <p className="text-sm text-muted">
                      {selectedDetail.transferType} — {id.ppob.fee}:{" "}
                      {formatRupiah(selectedDetail.fee)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      resetChannel()
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
                  <TextField
                    fullWidth
                    value={accountNumber}
                    onChange={(value) => setAccountNumber(value.replace(/\D/g, ""))}
                  >
                    <Label className="text-base">{id.ppob.accountNumber}</Label>
                    <Input
                      className="h-12 font-mono text-xl"
                      inputMode="numeric"
                      placeholder={id.ppob.accountNumberPlaceholder}
                    />
                  </TextField>

                  <TextField
                    fullWidth
                    value={amount}
                    onChange={(value) => setAmount(value.replace(/\D/g, ""))}
                  >
                    <Label className="text-base">{id.ppob.amount}</Label>
                    <Input
                      className="h-12 font-mono text-xl"
                      inputMode="numeric"
                      placeholder={id.ppob.amountPlaceholder}
                    />
                  </TextField>

                  <TextField fullWidth value={description} onChange={setDescription}>
                    <Label>{id.ppob.description}</Label>
                    <Input placeholder={id.ppob.descriptionPlaceholder} />
                  </TextField>

                  <TextField fullWidth value={senderName} onChange={setSenderName}>
                    <Label>{id.ppob.senderName}</Label>
                    <Input placeholder={id.ppob.senderNamePlaceholder} />
                  </TextField>

                  <TextField
                    fullWidth
                    value={senderPhone}
                    onChange={(value) => setSenderPhone(value.replace(/\D/g, ""))}
                  >
                    <Label>{id.ppob.senderPhone}</Label>
                    <Input
                      className="font-mono"
                      inputMode="tel"
                      placeholder={id.ppob.senderPhonePlaceholder}
                    />
                  </TextField>
                </div>
              </Card.Content>
            </Card>
          )}
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {selectedChannel && selectedDetail && isFormValid ? (
              <Card className="border-accent">
                <Card.Header>
                  <Card.Title className="text-lg">{id.ppob.confirm}</Card.Title>
                </Card.Header>
                <Card.Content className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.selectBank}</span>
                    <span className="font-medium">{selectedChannel.channel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.accountNumber}</span>
                    <span className="font-mono text-base font-medium">{accountNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.amount}</span>
                    <span className="font-medium">{formatRupiah(amountNum)}</span>
                  </div>
                  {description && (
                    <div className="flex justify-between">
                      <span className="text-muted">{id.ppob.description}</span>
                      <span>{description}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.senderName}</span>
                    <span>{senderName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{id.ppob.senderPhone}</span>
                    <span className="font-mono text-base font-medium">{senderPhone}</span>
                  </div>
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">{id.ppob.fee}</span>
                      <span>{formatRupiah(fee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-muted">{id.ppob.totalPayment}</span>
                      <span className="text-lg font-bold">{formatRupiah(total)}</span>
                    </div>
                  </div>
                  <Button className="mt-4 w-full" isDisabled size="lg">
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </Card.Content>
              </Card>
            ) : channels ? (
              <div className="py-8 text-center text-sm text-muted">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
