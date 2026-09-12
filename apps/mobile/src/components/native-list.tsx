import type { JSX } from "react";

import type {
  NativeProductListProps,
  NativeSettingsListProps,
} from "@/components/native-list.types";

/**
 * Stub for every platform that is not iOS.
 *
 * `@expo/ui/swift-ui` resolves its native view at import time, so the real
 * implementation cannot be imported anywhere it does not exist — not even
 * behind a runtime check. Metro picks `native-list.ios.tsx` on iOS and this
 * file everywhere else, which keeps SwiftUI out of the Android bundle entirely.
 *
 * Nothing renders these: callers gate on `hasSwiftUI` and draw the React Native
 * list instead.
 */
export function NativeProductList(_props: NativeProductListProps): JSX.Element | null {
  return null;
}

export function NativeSettingsList(_props: NativeSettingsListProps): JSX.Element | null {
  return null;
}
