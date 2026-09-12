import type { ReactNode } from "react"

interface ValueRenderProps {
  isPlaceholder: boolean
  defaultChildren: ReactNode
  /** `textValue` dari item terpilih. */
  selectedText: string
}

/**
 * Isi pemicu `Select` / `Autocomplete`: teks pilihan saja.
 *
 * Tanpa ini React Aria menyalin *seluruh* isi `ListBox.Item` yang terpilih ke
 * dalam pemicu — termasuk `Label`-nya dan centang `ListBox.ItemIndicator`. Dua
 * akibatnya nyata: centang ikut muncul di pemicu, dan `Label` salinan memakai id
 * yang sama dengan label kolomnya, sehingga `aria-labelledby` pemicu putus
 * begitu pilihan dikosongkan dan React Aria mengeluh kolomnya tak berlabel.
 *
 * Dipakai sebagai children: `<Select.Value>{selectedText}</Select.Value>`.
 */
export function selectedText({
  isPlaceholder,
  defaultChildren,
  selectedText: text,
}: ValueRenderProps): ReactNode {
  return isPlaceholder ? defaultChildren : text
}
