import type { useRouter } from "expo-router";

import { hapticError, hapticSuccess } from "@/lib/haptics";

type Router = ReturnType<typeof useRouter>;

interface MutationFeedback {
  onSuccess: () => void;
  onError: () => void;
}

/**
 * What every stock write on this app does when it lands: a confirming tap, then
 * back to the screen that asked for it — the product detail, which now shows the
 * new number.
 *
 * Spelled once because four screens (count, write-off, price edit, new product)
 * had the same six lines, and a phone that buzzes on three of four saves reads
 * as a bug.
 */
export function savedThenBack(router: Router): MutationFeedback {
  return {
    onSuccess: () => {
      hapticSuccess();
      router.back();
    },
    onError: hapticError,
  };
}
