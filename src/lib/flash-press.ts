/** Lama tombol tampak "ditekan" saat dipicu dari papan ketik, dalam ms. */
const FLASH_MS = 150

/**
 * Tunjukkan bahwa sebuah tombol baru saja dipicu lewat pintasan papan ketik:
 * tombolnya berkedip seperti diklik. HeroUI menggambar keadaan tertekan dari
 * `data-pressed="true"` (`transform: scale(.97)` + warna tekan), dan React
 * Aria hanya menyalakannya untuk tekanan sungguhan — pintasan yang memanggil
 * handler-nya langsung tidak memberi umpan balik apa pun, sehingga kasir tidak
 * yakin tombolnya kena. Atributnya dipasang tangan sebentar lalu dilepas; React
 * tidak mengelola atribut ini selama tombol tidak sedang ditekan, jadi tidak
 * ada yang menimpanya di tengah jalan.
 */
export function flashPress(element: HTMLElement | null | undefined) {
  if (!element) return
  element.setAttribute("data-pressed", "true")
  window.setTimeout(() => {
    if (element.getAttribute("data-pressed") === "true") {
      element.removeAttribute("data-pressed")
    }
  }, FLASH_MS)
}
