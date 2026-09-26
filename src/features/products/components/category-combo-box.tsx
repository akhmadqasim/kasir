import { ComboBox, EmptyState, Input, Label, ListBox } from "@heroui/react"

import { id } from "@/i18n/id"
import type { Category } from "../types"

/**
 * Nilai sentinel `ComboBox`: React Aria memakai `null` untuk "tidak ada pilihan",
 * dan `null` tidak bisa dipakai sebagai `id` item. Baris "Tanpa kategori"
 * menggantikan tombol silang milik combobox lama — sekarang bisa dicapai dengan
 * panah, bukan cuma dengan mouse, dan produk tanpa kategori menyebut keadaannya
 * alih-alih terlihat seperti kolom yang belum diisi.
 */
const NO_CATEGORY = "none"

interface CategoryComboBoxProps {
  categories: Pick<Category, "id" | "name">[]
  /** Id kategori sebagai string; `""` untuk produk tanpa kategori. */
  value: string
  onValueChange: (value: string) => void
}

/**
 * Pemilih kategori: ketik untuk menyaring, panah untuk memilih.
 *
 * Kategori baru tetap tidak bisa dibuat dari sini — `create_product` hanya
 * menerima `category_id`, dan combobox lama juga mengembalikan teks yang tidak
 * cocok ke nama kategori terpilih begitu kolomnya kehilangan fokus. Karena itu
 * `allowsCustomValue` sengaja tidak dipasang: nama asing hanya akan tersimpan
 * sebagai produk tanpa kategori tanpa memberi tahu kasirnya.
 */
export function CategoryComboBox({ categories, value, onValueChange }: CategoryComboBoxProps) {
  return (
    <ComboBox
      allowsEmptyCollection
      fullWidth
      variant="secondary"
      // Sentinelnya harus benar-benar jadi kunci terpilih, bukan dipetakan balik
      // ke `null`: React Aria menutup popover lewat perubahan `selectedKey`, jadi
      // kunci yang tak pernah sampai membuat daftarnya menggantung terbuka.
      value={value || NO_CATEGORY}
      onChange={(key) => {
        const picked = Array.isArray(key) ? key[0] : key
        onValueChange(picked == null || picked === NO_CATEGORY ? "" : String(picked))
      }}
    >
      <Label>{id.products.category}</Label>
      <ComboBox.InputGroup>
        <Input placeholder="Pilih kategori..." />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          aria-label={id.products.category}
          renderEmptyState={() => <EmptyState>Kategori tidak ditemukan</EmptyState>}
        >
          <ListBox.Item id={NO_CATEGORY} textValue="Tanpa kategori">
            <Label>Tanpa kategori</Label>
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {categories.map((category) => (
            <ListBox.Item key={category.id} id={String(category.id)} textValue={category.name}>
              <Label>{category.name}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
