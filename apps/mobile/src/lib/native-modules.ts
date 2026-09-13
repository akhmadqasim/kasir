import { requireOptionalNativeModule } from "expo-modules-core";

import { isIOS } from "@/lib/platform";

/**
 * Whether this binary can actually draw SF Symbols.
 *
 * `expo-symbols` is documented as shipping inside Expo Go, but "documented" is
 * not "present in the build on this phone" — an older Expo Go, or a dev client
 * made before the dependency was added, and `SymbolView` renders nothing at
 * all. That is what hid the scanner's camera button: a symbol that never drew,
 * with no fallback behind it.
 *
 * `requireOptionalNativeModule` answers without throwing, so `PlatformIcon` can
 * fall back to a font glyph, which always renders.
 */
export const hasSfSymbols = isIOS && requireOptionalNativeModule("SymbolModule") !== null;
