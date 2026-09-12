import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * `true` while the app is in the foreground.
 *
 * The camera keeps running when the phone is locked or the user switches away,
 * which drains the battery and — on a shop floor — leaves a lens pointed at
 * whatever the phone is lying on. `inactive` (the iOS app switcher, a call
 * banner) counts as "not active" so the preview stops there too.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  return active;
}
