import "@testing-library/jest-dom/vitest"

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
