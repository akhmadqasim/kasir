import { useCallback, useRef, useState } from "react"

/**
 * Runs one job at a time; a job started while another is out is dropped. The
 * guard is a ref, so two presses in one tick still run one job. `quiet` keeps
 * `isPending` off, for a job that reports its progress elsewhere.
 */
export function useSingleFlight() {
  const busyRef = useRef(false)
  const [isPending, setIsPending] = useState(false)

  const run = useCallback(
    async (job: () => Promise<void>, { quiet = false } = {}): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      if (!quiet) setIsPending(true)
      try {
        await job()
      } finally {
        busyRef.current = false
        if (!quiet) setIsPending(false)
      }
    },
    [],
  )

  return { isPending, run }
}
