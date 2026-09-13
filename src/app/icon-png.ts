/** The square the window icon is drawn at; Windows scales it down from here. */
export const ICON_SIZE = 256

/**
 * Draw the image at `src` as a square PNG for the window icon: fitted inside
 * the square, centred, on a transparent ground. The browser decodes it, so a
 * PNG, JPEG, WebP or SVG logo all come out the same — which is why the icon is
 * rendered here and not in Rust.
 */
export async function renderIconPng(src: string): Promise<Blob> {
  const image = new Image()
  image.src = src
  await image.decode()

  const canvas = document.createElement("canvas")
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("canvas 2d context unavailable")

  const scale = Math.min(ICON_SIZE / image.naturalWidth, ICON_SIZE / image.naturalHeight)
  const width = Math.round(image.naturalWidth * scale)
  const height = Math.round(image.naturalHeight * scale)
  context.drawImage(image, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("canvas could not encode the icon"))
    }, "image/png")
  })
}
