import { SearchField, type SearchFieldProps } from "@heroui/react"

export interface SearchInputProps extends Omit<SearchFieldProps, "children"> {
  /** Nama aksesibel kolomnya — tidak ada `Label` terlihat pada bar pencarian. */
  "aria-label": string
  placeholder?: string
}

/**
 * Bar pencarian di atas tabel: produk, pengguna, transaksi, laporan.
 *
 * Susunannya persis contoh bawaan `SearchField` HeroUI — `Group` berisi ikon,
 * kolom, dan tombol hapus — ditulis satu kali. Enam layar pernah menyalin blok
 * yang sama kata demi kata; yang berbeda di antara mereka hanya `placeholder`
 * dan lebarnya, dan keduanya tetap prop di sini.
 *
 * Varian bawaan (`primary`) karena bar pencarian berdiri langsung di atas
 * kanvas halaman, bukan di dalam kartu (DESIGN.md §4).
 */
export function SearchInput({ placeholder, ...props }: SearchInputProps) {
  return (
    <SearchField {...props}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={placeholder} />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  )
}
