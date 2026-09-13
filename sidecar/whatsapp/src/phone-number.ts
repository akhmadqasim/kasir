/**
 * Indonesian phone number normalisation for WhatsApp chat ids.
 *
 * A cashier types whatever the customer says out loud: `0812...`, `812...`,
 * `+62812...`, with spaces or dashes anywhere. WhatsApp's own ids only
 * recognise one shape — the country code with no leading zero, digits only —
 * so every number is normalised to that shape before it is used, here rather
 * than in Rust, because this is the only side of the protocol that ever turns
 * a number into a chat id.
 */

/** Strip everything but digits — spaces, dashes, parens, a leading `+`. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "")
}

/**
 * `08xx`, `8xx`, `+62xx` or `62xx` → `62xx`. `null` for anything that is not a
 * plausible Indonesian mobile number once normalised: empty input, a number
 * that is not a mobile number (does not start `8` after the country code), or
 * one too short or too long to be real.
 */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = digitsOnly(raw)
  if (!digits) return null

  let national: string
  if (digits.startsWith("62")) {
    national = digits
  } else if (digits.startsWith("0")) {
    national = `62${digits.slice(1)}`
  } else if (digits.startsWith("8")) {
    national = `62${digits}`
  } else {
    return null
  }

  const subscriber = national.slice(2)
  // Indonesian mobile numbers run 9-13 digits after the `62`/leading `0`
  // (e.g. `812-3456-789` to `812-3456-789-012`); anything shorter or longer
  // is not one, whatever prefix it happened to normalise past.
  if (subscriber.length < 9 || subscriber.length > 13) return null
  if (!subscriber.startsWith("8")) return null

  return national
}

/** The WhatsApp chat id for an already-normalised number. */
export function toChatId(normalized: string): string {
  return `${normalized}@c.us`
}
