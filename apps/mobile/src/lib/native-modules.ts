import { requireOptionalNativeModule } from "expo-modules-core";

import { isIOS } from "@/lib/platform";

/**
 * Which native modules this binary actually has.
 *
 * Both `expo-symbols` and `@expo/ui` are documented as shipping inside Expo Go,
 * but "documented" is not "present in the build on this phone" — an older Expo
 * Go, a custom dev client built before the dependency was added, or a future
 * SDK that drops one, and the screen renders nothing at all. That is exactly
 * what happened to the scanner's camera button: an SF Symbol that never drew,
 * and no fallback behind it.
 *
 * `requireOptionalNativeModule` answers the question without throwing, so every
 * use of these APIs can pick a plain React Native drawing instead.
 */
export const hasSfSymbols = isIOS && requireOptionalNativeModule("SymbolModule") !== null;

/** SwiftUI hosting — `@expo/ui/swift-ui`'s `Host`, `List`, `Form`, `Section`. */
export const hasSwiftUI = isIOS && requireOptionalNativeModule("ExpoUI") !== null;
