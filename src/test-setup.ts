import "@testing-library/jest-dom/vitest"
import { configure } from "@testing-library/react"

/**
 * `findBy*` menunggu 1000 ms secara bawaan. Layar HeroUI jauh lebih berat
 * dirender daripada shadcn — satu layar bisa memasang beberapa portal, focus
 * scope, dan koleksi React Aria sekaligus — dan Vitest menjalankan file test
 * secara paralel, jadi worker-worker itu berebut CPU. Hasilnya: test yang lulus
 * sendirian mulai kehabisan waktu begitu suite-nya penuh, dan file yang gagal
 * berpindah-pindah tiap run.
 *
 * Menaikkan batasnya menunggu penjadwalan, bukan menyembunyikan kegagalan:
 * assertion-nya tetap harus terpenuhi, hanya diberi waktu lebih panjang untuk
 * itu. Test yang benar-benar salah tetap merah, cuma lebih lambat melapor.
 *
 * 5 detik masih pecah kalau mesinnya sedang menjalankan `cargo build` di saat
 * yang sama, dan itu bukan keadaan yang aneh di repo ini. Batas panjang tidak
 * memperlambat test yang lulus — hanya yang memang sedang menunggu.
 */
configure({ asyncUtilTimeout: 15_000 })

/**
 * jsdom ships a `matchMedia` stub whose `matches` is always false, which makes the
 * responsive parts of the layout shell untestable. Back it with `window.innerWidth`
 * instead, and re-evaluate every list on `resize`, so a test can widen or narrow the
 * window and watch the sidebar react.
 */
type MediaListener = (event: MediaQueryListEvent) => void

const notifyAll: Array<() => void> = []

function evaluate(query: string): boolean {
  const max = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query)
  if (max) return window.innerWidth <= Number(max[1])
  const min = /\(min-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query)
  if (min) return window.innerWidth >= Number(min[1])
  return false
}

window.matchMedia = (query: string): MediaQueryList => {
  const listeners = new Set<MediaListener>()
  let lastMatches = evaluate(query)

  const list = {
    media: query,
    onchange: null,
    get matches() {
      return evaluate(query)
    },
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners.delete(listener)
    },
    addListener: (listener: MediaListener) => {
      listeners.add(listener)
    },
    removeListener: (listener: MediaListener) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList

  notifyAll.push(() => {
    const matches = evaluate(query)
    if (matches === lastMatches) return
    lastMatches = matches
    const event = { matches, media: query } as MediaQueryListEvent
    listeners.forEach((listener) => listener(event))
  })

  return list
}

window.addEventListener("resize", () => {
  notifyAll.forEach((notify) => notify())
})

/**
 * jsdom tidak punya `ResizeObserver`, dan beberapa komponen HeroUI membuatnya
 * langsung — `ScrollShadow` melempar saat render tanpa ini, sehingga seluruh
 * layar yang memakainya gagal dirender di test. Stub ini sengaja diam: jsdom
 * tidak melakukan layout, jadi tidak ada ukuran yang bisa dilaporkan.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

window.ResizeObserver ??= ResizeObserverStub

/**
 * jsdom tidak mengimplementasikan Web Animations API. React Aria memakai
 * `element.getAnimations()` untuk menunggu transisi selesai — `Tabs.Indicator`
 * lewat `SharedElementTransition`, dan komponen lain yang beranimasi ikut jalur
 * yang sama. Tanpa stub ini, test yang benar-benar *berpindah* tab melempar
 * `TypeError` dari dalam React Aria, jadi perpindahan tab tidak bisa diuji sama
 * sekali.
 *
 * Mengembalikan array kosong berarti "tidak ada animasi berjalan", sehingga
 * React Aria langsung menganggap transisinya selesai — perilaku yang tepat di
 * lingkungan tanpa layout dan tanpa animasi.
 */
Element.prototype.getAnimations ??= () => []
