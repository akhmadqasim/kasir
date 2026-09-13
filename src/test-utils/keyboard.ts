import { fireEvent } from "@testing-library/react"

/**
 * Tekan satu tombol pada elemen yang sedang fokus, lengkap dengan keyup.
 *
 * React Aria menjalankan aksi Enter dan Space pada *keyup*, seperti tombol
 * asli, jadi `fireEvent.keyDown` saja tidak pernah memicu `onPress` maupun
 * `onAction`. Fokusnya dibaca dari `document.activeElement` karena begitulah
 * tombol sungguhan sampai ke dialog — menjalar dari elemen yang fokus, bukan
 * dilempar ke `window`.
 */
export function pressKey(key: string, target: Element = document.activeElement ?? document.body) {
  fireEvent.keyDown(target, { key })
  fireEvent.keyUp(target, { key })
}
