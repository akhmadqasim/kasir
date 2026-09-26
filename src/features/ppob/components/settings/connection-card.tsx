import { RefreshCw, Save } from "lucide-react"
import {
  Button,
  Card,
  Description,
  Input,
  InputGroup,
  Label,
  Switch,
  TextField,
} from "@heroui/react"

import { CardHeading } from "@/components/card-heading"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import type { PpobSettingsForm } from "./use-ppob-settings-form"

const STORED_PLACEHOLDER = "Tersimpan — isi hanya jika ingin mengganti"

/** Kartu koneksi Mitra: saklar aktif, nomor HP, password, dan device ID. */
export function ConnectionCard({ form }: { form: PpobSettingsForm }) {
  const { connection, updateConnection, hasStoredCredentials } = form
  const { enabled } = connection

  return (
    <Card>
      <Card.Header>
        <CardHeading>{id.ppob.connectionTitle}</CardHeading>
        <Card.Description>{id.ppob.connectionDesc}</Card.Description>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. */}
        {/* Mati sampai pengaturan dimuat: sakelar yang ditekan lebih dulu
            ditimpa diam-diam oleh nilai dari server begitu datang. */}
        <Switch
          isDisabled={!form.isReady}
          isSelected={enabled}
          onChange={(value) => updateConnection({ enabled: value })}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {id.ppob.enabled}
          </Switch.Content>
          <Description>{id.ppob.enabledDesc}</Description>
        </Switch>

        <div className="flex flex-col gap-4">
          <TextField
            fullWidth
            isDisabled={!enabled}
            type="tel"
            value={connection.phoneNumber}
            variant="secondary"
            onChange={(value) => updateConnection({ phoneNumber: value })}
          >
            <Label>{id.ppob.mitraPhone}</Label>
            <Input
              autoComplete="off"
              className="tabular-nums"
              inputMode="tel"
              placeholder={id.ppob.mitraPhonePlaceholder}
            />
          </TextField>

          <TextField
            fullWidth
            isDisabled={!enabled}
            type="password"
            value={connection.password}
            variant="secondary"
            onChange={(value) => updateConnection({ password: value })}
          >
            <Label>{id.ppob.mitraPassword}</Label>
            <Input
              autoComplete="new-password"
              placeholder={
                hasStoredCredentials ? STORED_PLACEHOLDER : id.ppob.mitraPasswordPlaceholder
              }
            />
            {/* Keterangan kolom, bukan paragraf lepas di bawah formulir: pembaca
                layar membacakannya saat kolom password difokuskan. */}
            <Description>
              {hasStoredCredentials
                ? "Password sudah tersimpan dan tidak pernah dikirim kembali ke layar ini. Kosongkan untuk mempertahankannya, atau isi untuk menggantinya."
                : "Password belum tersimpan. Isi untuk mengaktifkan layanan PPOB."}
            </Description>
          </TextField>

          {/* Tombol generate di dalam kolomnya, contoh "Copy Button Suffix"
              dari dokumentasi InputGroup — bukan tombol terpisah yang harus
              disejajarkan tangan ke dasar kolom. */}
          <TextField
            fullWidth
            isDisabled={!enabled}
            value={connection.deviceId}
            variant="secondary"
            onChange={(value) => updateConnection({ deviceId: value })}
          >
            <Label>{id.ppob.mitraDeviceId}</Label>
            <InputGroup fullWidth variant="secondary">
              <InputGroup.Input placeholder={id.ppob.mitraDeviceIdPlaceholder} />
              <InputGroup.Suffix className="pe-0">
                <Button
                  aria-label="Buat Device ID baru"
                  isDisabled={!enabled}
                  isIconOnly
                  size="sm"
                  type="button"
                  variant="tertiary"
                  onPress={() => updateConnection({ deviceId: crypto.randomUUID() })}
                >
                  <RefreshCw />
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            <Description>
              Masukkan device ID dari HP, atau tekan tombol di kanan kolom untuk membuat ID baru.
            </Description>
          </TextField>
        </div>
      </Card.Content>
      {/* Dua tombol Simpan (di sini dan di kartu Markup) memanggil mutasi yang
          sama; test menghitung keduanya. Menyatukannya adalah keputusan pemilik. */}
      <Card.Footer className="flex-wrap items-center gap-2">
        <PendingButton isDisabled={!form.isReady} isPending={form.isSaving} onPress={form.save}>
          <Save />
          {id.common.save}
        </PendingButton>
        <PendingButton
          isDisabled={!enabled || !connection.phoneNumber}
          isPending={form.isTesting}
          variant="secondary"
          onPress={form.testConnection}
        >
          {id.ppob.testConnection}
        </PendingButton>
        {/* Tes memakai kredensial yang sudah tersimpan di server, bukan isian
            yang belum disimpan — tanpa kalimat ini hasilnya menyesatkan. */}
        <p className="text-xs text-muted">Tes memakai pengaturan yang sudah disimpan.</p>
      </Card.Footer>
    </Card>
  )
}
