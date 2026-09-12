import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  Skeleton,
  Surface,
  TextField,
} from "@heroui/react"

import { SubpageHeader } from "@/components/layout/subpage-header"
import { NoData } from "@/components/no-data"
import { SearchInput } from "@/components/search-input"
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
                // Transfer belum tersambung ke backend; tombolnya tetap ada
                // supaya bentuk kartunya sama dengan flow lain.
                <Button fullWidth isDisabled size="lg">
                  {id.ppob.notAvailable}
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
              title={id.ppob.confirm}
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
            <SearchInput
              aria-label={id.ppob.searchBank}
              className="max-w-sm"
              placeholder={id.ppob.searchBank}
              value={search}
              onChange={setSearch}
            />

            {isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <NoData title={id.ppob.bankNotFound} />
            ) : (
              // Daftar aksi seperti contoh "With Sections" ListBox: `Surface`
              // membingkainya, `onAction` memilih.
              <Surface className="max-h-[60vh] overflow-y-auto">
                <ListBox
                  aria-label={id.ppob.selectBank}
                  className="p-2"
                  selectionMode="none"
                  onAction={(key) => {
                    const ch = filtered.find((candidate) => candidate.channel === key)
                    if (!ch) return
                    setSelectedChannel(ch)
                    if (ch.details.length === 1) {
                      setSelectedDetail(ch.details[0])
                    }
                  }}
                >
                  {filtered.map((ch) => (
                    <ListBox.Item key={ch.channel} id={ch.channel} textValue={ch.channel}>
                      <div className="flex min-w-0 flex-col">
                        <Label>{ch.channel}</Label>
                        <Description>{ch.details.length} tipe transfer</Description>
                      </div>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Surface>
            )}
          </>
        )}

        {/* Channel Detail Selection (if multiple) */}
        {selectedChannel && !selectedDetail && selectedChannel.details.length > 1 && (
          <Card>
            <Card.Header>
              <Card.Title>{selectedChannel.channel}</Card.Title>
            </Card.Header>
            <Card.Content>
              <ListBox
                aria-label="Tipe transfer"
                selectionMode="none"
                onAction={(key) => {
                  const detail = selectedChannel.details.find(
                    (candidate) => candidate.channelId === key,
                  )
                  if (detail) setSelectedDetail(detail)
                }}
              >
                {selectedChannel.details.map((detail) => (
                  <ListBox.Item
                    key={detail.channelId}
                    id={detail.channelId}
                    textValue={detail.transferType}
                  >
                    <div className="flex min-w-0 flex-col">
                      <Label>{detail.transferType}</Label>
                      <Description className="tabular-nums">
                        {id.ppob.fee}: {formatRupiah(detail.fee)}
                      </Description>
                    </div>
                  </ListBox.Item>
                ))}
              </ListBox>
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
