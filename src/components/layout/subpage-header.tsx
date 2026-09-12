import type { ReactNode } from "react"
import { Button } from "@heroui/react"
import { ArrowLeftIcon } from "lucide-react"

import { NavbarActions, NavbarTitle } from "./app-navbar"

/**
 * Kepala sub-halaman — riwayat PPOB, mutasi, notifikasi, buat refund, tutup
 * kasir: tombol kembali, judul, dan aksi, semuanya di navbar.
 *
 * Tidak merender apa pun di badan halaman. Sebelumnya ada tiga cara: `<h1>` di
 * badan dengan tombol kembali di sebelahnya, judul di navbar dengan tombol
 * kembali di badan, dan keduanya di navbar. Yang terakhir yang dipilih karena
 * navbar adalah satu-satunya tempat yang sudah pasti ada di setiap halaman,
 * dan tombol kembali di posisi tombol lipat sidebar sudah dikenal mata.
 *
 * Tombol kembalinya `sm tertiary` ikon saja, seperti aksi cepat lain di
 * navbar; label "Kembali" ada untuk pembaca layar.
 */
export function SubpageHeader({
  title,
  onBack,
  actions,
}: {
  title: string
  onBack: () => void
  actions?: ReactNode
}) {
  return (
    <>
      <NavbarTitle
        leading={
          <Button isIconOnly aria-label="Kembali" size="sm" variant="tertiary" onPress={onBack}>
            <ArrowLeftIcon />
          </Button>
        }
      >
        {title}
      </NavbarTitle>
      {actions ? <NavbarActions>{actions}</NavbarActions> : null}
    </>
  )
}
