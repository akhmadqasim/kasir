import type { ReceiptLine } from "../types"

/** Kolom kertas: 32 untuk 58 mm, 42 untuk 80 mm — sama dengan backend. */
export function receiptColumns(paperWidth: number | null | undefined): number {
  return paperWidth === 80 ? 42 : 32
}

const FONT_PX = 28
const LINE_HEIGHT = 1.4
const PADDING = 32
const FONT_FAMILY = 'ui-monospace, Consolas, "Cascadia Mono", "Courier New", monospace'

/**
 * Struk sebagai gambar PNG, digambar dari baris yang sama persis dengan
 * yang dikirim ke printer: huruf mono, kertas putih, tebal untuk baris
 * `bold`, ukuran ganda untuk token PLN. Digambar di sini, bukan di Rust,
 * karena browser sudah punya rasterizer huruf; dua kali lipat resolusi
 * layar supaya tetap tajam saat WhatsApp mengecilkannya.
 */
export async function renderReceiptPng(lines: ReceiptLine[], columns: number): Promise<Blob> {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) throw new Error("canvas 2d context unavailable")

  context.font = `${FONT_PX}px ${FONT_FAMILY}`
  const charWidth = context.measureText("0").width
  const lineHeight = Math.round(FONT_PX * LINE_HEIGHT)
  const rows = lines.reduce((sum, line) => sum + (line.size === "double" ? 2 : 1), 0)

  canvas.width = Math.ceil(columns * charWidth + PADDING * 2)
  canvas.height = rows * lineHeight + PADDING * 2

  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#000000"
  context.textBaseline = "top"

  let y = PADDING
  for (const line of lines) {
    const size = line.size === "double" ? FONT_PX * 2 : FONT_PX
    context.font = `${line.bold ? "bold " : ""}${size}px ${FONT_FAMILY}`
    context.fillText(line.text, PADDING, y)
    y += line.size === "double" ? lineHeight * 2 : lineHeight
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("canvas could not encode the receipt"))
    }, "image/png")
  })
}
