/**
 * One line of a struk exactly as the printer would set it — same text, same
 * weight — for `ReceiptPreview` to draw. Mirrors `ReceiptLineResponse` in
 * `src-tauri/src/domain/receipt.rs`.
 */
export interface ReceiptLine {
  text: string
  bold: boolean
  /** `"double"` is only ever seen on a PPOB token line; a sale receipt is
   * always `"normal"`, but the field rides along either way. */
  size: "normal" | "double"
}
