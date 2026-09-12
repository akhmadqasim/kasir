import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Card, Input, Label, SearchField, Skeleton, TextField } from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { id } from "@/i18n/id"
import { formatRupiah } from "@/lib/format"
import { useTransferChannels } from "../hooks"
import type { TransferChannelGroup, TransferChannelDetail } from "../types"
import { FlowColumns } from "./flow-columns"
import { ConfirmCard } from "./quick-access/confirm-card"

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
    <div className="flex flex-col gap-6">
      <SubpageHeader title={id.ppob.transfer} onBack={() => navigate("/ppob")} />

      <FlowColumns
        aside={
          selectedChannel && selectedDetail && isFormValid ? (
            <ConfirmCard
              footer={
                <Button fullWidth isDisabled size="lg">
                  {id.ppob.process} (Coming Soon)
                </Button>
              }
              items={[
                { label: id.ppob.selectBank, value: selectedChannel.channel },
                { label: id.ppob.accountNumber, value: accountNumber, tone: "mono" },
                { label: id.ppob.amount, value: formatRupiah(amountNum) },
                ...(description ? [{ label: id.ppob.description, value: description }] : []),
                { label: id.ppob.senderName, value: senderName },
                { label: id.ppob.senderPhone, value: senderPhone, tone: "mono" },
              ]}
              title={<Card.Title>{id.ppob.confirm}</Card.Title>}
              totals={[
                { label: id.ppob.fee, value: formatRupiah(fee) },
                { label: id.ppob.totalPayment, value: formatRupiah(total), tone: "strong" },
              ]}
            />
          ) : channels ? (
            <Card>
              <Card.Content>
                <NoData title="Pilih produk untuk melihat konfirmasi" />
              </Card.Content>
            </Card>
          ) : null
        }
      >
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
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : (
              <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                {filtered.map((ch) => (
                  <Button
                    key={ch.channel}
                    fullWidth
                    className="h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-4 text-left"
                    variant="secondary"
                    onPress={() => {
                      setSelectedChannel(ch)
                      if (ch.details.length === 1) {
                        setSelectedDetail(ch.details[0])
                      }
                    }}
                  >
                    <span>{ch.channel}</span>
                    <span className="text-muted">{ch.details.length} tipe transfer</span>
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
              <Card.Title>{selectedChannel.channel}</Card.Title>
            </Card.Header>
            <Card.Content className="gap-2">
              {selectedChannel.details.map((detail) => (
                <Button
                  key={detail.channelId}
                  fullWidth
                  className="h-auto justify-between whitespace-normal px-4 py-3"
                  variant="secondary"
                  onPress={() => setSelectedDetail(detail)}
                >
                  <span>{detail.transferType}</span>
                  <span className="text-muted tabular-nums">
                    {id.ppob.fee}: {formatRupiah(detail.fee)}
                  </span>
                </Button>
              ))}
            </Card.Content>
            <Card.Footer>
              <Button size="sm" variant="tertiary" onPress={resetChannel}>
                Ganti Bank
              </Button>
            </Card.Footer>
          </Card>
        )}

        {/* Transfer Form */}
        {selectedChannel && selectedDetail && (
          <Card>
            <Card.Header className="flex-row items-start justify-between gap-2">
              <div className="min-w-0">
                <Card.Title>{selectedChannel.channel}</Card.Title>
                <Card.Description>
                  {selectedDetail.transferType} — {id.ppob.fee}: {formatRupiah(selectedDetail.fee)}
                </Card.Description>
              </div>
              <Button
                size="sm"
                variant="tertiary"
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
            </Card.Header>
            <Card.Content>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  fullWidth
                  value={accountNumber}
                  variant="secondary"
                  onChange={(value) => setAccountNumber(value.replace(/\D/g, ""))}
                >
                  <Label>{id.ppob.accountNumber}</Label>
                  <Input
                    className="tabular-nums"
                    inputMode="numeric"
                    placeholder={id.ppob.accountNumberPlaceholder}
                  />
                </TextField>

                <TextField
                  fullWidth
                  value={amount}
                  variant="secondary"
                  onChange={(value) => setAmount(value.replace(/\D/g, ""))}
                >
                  <Label>{id.ppob.amount}</Label>
                  <Input
                    className="text-right tabular-nums"
                    inputMode="numeric"
                    placeholder={id.ppob.amountPlaceholder}
                  />
                </TextField>

                <TextField
                  fullWidth
                  value={description}
                  variant="secondary"
                  onChange={setDescription}
                >
                  <Label>{id.ppob.description}</Label>
                  <Input placeholder={id.ppob.descriptionPlaceholder} />
                </TextField>

                <TextField
                  fullWidth
                  value={senderName}
                  variant="secondary"
                  onChange={setSenderName}
                >
                  <Label>{id.ppob.senderName}</Label>
                  <Input placeholder={id.ppob.senderNamePlaceholder} />
                </TextField>

                <TextField
                  fullWidth
                  value={senderPhone}
                  variant="secondary"
                  onChange={(value) => setSenderPhone(value.replace(/\D/g, ""))}
                >
                  <Label>{id.ppob.senderPhone}</Label>
                  <Input
                    className="tabular-nums"
                    inputMode="tel"
                    placeholder={id.ppob.senderPhonePlaceholder}
                  />
                </TextField>
              </div>
            </Card.Content>
          </Card>
        )}
      </FlowColumns>
    </div>
  )
}
