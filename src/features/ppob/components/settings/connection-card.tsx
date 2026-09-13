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

import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import type { PpobSettingsForm } from "./use-ppob-settings-form"

const STORED_PLACEHOLDER = "Tersimpan — isi hanya jika ingin mengganti"

/** Kartu koneksi Mitra: saklar aktif, nomor HP, password, device ID, dan PIN. */
export function ConnectionCard({ form }: { form: PpobSettingsForm }) {
  const { connection, updateConnection, hasStoredCredentials } = form
  const { enabled } = connection

  return (
    <Card>
      <Card.Header>
        <Card.Title>{id.ppob.connectionTitle}</Card.Title>
        <Card.Description>{id.ppob.connectionDesc}</Card.Description>
      </Card.Header>
      <Card.Content className="gap-6">
        {/* Susunan "With Description" dari dokumentasi Switch: kontrol di kiri,
            label di kanannya, keterangan di bawah. */}
        <Switch isSelected={enabled} onChange={(value) => updateConnection({ enabled: value })}>
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
            <Input placeholder={id.ppob.mitraPhonePlaceholder} />
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
              placeholder={
                hasStoredCredentials ? STORED_PLACEHOLDER : id.ppob.mitraPasswordPlaceholder
              }
            />
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
                  aria-label="Generate Device ID"
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
              Masukkan device ID dari HP atau klik tombol generate untuk membuat ID baru
            </Description>
          </TextField>

          <TextField
            fullWidth
            isDisabled={!enabled}
            type="password"
            value={connection.pin}
            variant="secondary"
            onChange={(value) => updateConnection({ pin: value })}
          >
            <Label>{id.ppob.mitraPin}</Label>
            <Input
              placeholder={hasStoredCredentials ? STORED_PLACEHOLDER : id.ppob.mitraPinPlaceholder}
            />
          </TextField>

          <p className="text-sm text-muted">
            {hasStoredCredentials
              ? "Password dan PIN sudah tersimpan dan tidak pernah dikirim kembali ke layar ini. Kosongkan keduanya untuk mempertahankannya, atau isi keduanya sekaligus untuk mengganti."
              : "Password dan PIN belum tersimpan. Isi keduanya untuk mengaktifkan layanan PPOB."}
          </p>
        </div>
      </Card.Content>
      {/* Dua tombol Simpan (di sini dan di kartu Markup) memanggil mutasi yang
          sama; test menghitung keduanya. Menyatukannya adalah keputusan pemilik. */}
      <Card.Footer className="gap-2">
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
      </Card.Footer>
    </Card>
  )
}
