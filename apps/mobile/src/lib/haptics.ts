import * as Haptics from "expo-haptics";

import { isIOS } from "@/lib/platform";

/**
 * Haptics by meaning, not by API call.
 *
 * iOS has a vocabulary for this — success / warning / error are distinct
 * patterns every app on the phone uses the same way — so the notification
 * feedback generator is the right call there. Android has no such vocabulary
 * and a buzz is more intrusive, so it gets one short impact for "yes" and the
 * error pattern only where something actually went wrong.
 *
 * Every call is fire-and-forget: a phone without a taptic engine rejects the
 * promise and that must never reach a screen.
 */
function fire(promise: Promise<void>): void {
  promise.catch(() => {
    // No haptic hardware, or the user turned system haptics off. Not our problem.
  });
}

/** A barcode resolved to a product, a write-off saved, a price updated. */
export function hapticSuccess(): void {
  fire(
    isIOS
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  );
}

/** A scan that found nothing, or a rule the form refuses to submit. */
export function hapticWarning(): void {
  fire(
    isIOS
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  );
}

/**
 * The request came back with an error.
 *
 * The one pattern that is *not* toned down on Android: a write that failed is
 * worth interrupting for, and Android's own error pattern exists for exactly
 * this.
 */
export function hapticError(): void {
  fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** A toggle flipped — the camera going on or off. iOS only; Android buzzes enough already. */
export function hapticSelection(): void {
  if (!isIOS) return;
  fire(Haptics.selectionAsync());
}
