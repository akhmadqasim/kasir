import { useRef, useState } from "react"

import type { InquiryResult } from "../../types"

/**
 * The inquiry answer for exactly the inputs on screen.
 *
 * The fields stay editable while an inquiry is in flight, so a cashier who
 * fixes one digit of the meter number after pressing "Cek" used to receive
 * the answer for the old number under the new one — the confirm card showed
 * the corrected IDPEL next to someone else's name and bill, and paying it
 * bought for the wrong customer. Every edit now calls `reset`, which bumps a
 * generation counter; an answer only lands if no edit happened since its
 * request was sent.
 */
export function useInquiryResult() {
  const [result, setResult] = useState<InquiryResult | null>(null)
  const generation = useRef(0)

  /** Inputs changed: drop the shown answer and any answer still on its way. */
  const reset = () => {
    generation.current += 1
    setResult(null)
  }

  /** Call when sending an inquiry; pass the returned setter as its `onSuccess`. */
  const accept = () => {
    generation.current += 1
    const sent = generation.current
    return (answer: InquiryResult) => {
      if (sent === generation.current) setResult(answer)
    }
  }

  return { result, reset, accept }
}
