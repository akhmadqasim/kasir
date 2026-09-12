import { Platform } from "react-native";

/**
 * The two or three facts every platform branch in this app needs, in one place
 * so a screen never re-derives them (and never gets the Android reading of
 * `Platform.Version`, which is an API level, mixed up with an iOS one).
 *
 * `apps/mobile/DESIGN.md` decides *what* differs; this file only says *where*
 * we are. Structural differences branch on `isIOS`/`isAndroid`; cosmetic ones
 * read a token from here.
 */
export const isIOS = Platform.OS === "ios";
export const isAndroid = Platform.OS === "android";

/** iOS major version, or `0` anywhere else. `26` is the Liquid Glass release. */
export const iosVersion = isIOS ? Number.parseInt(String(Platform.Version), 10) || 0 : 0;

/**
 * iOS 26 draws tab bars, toolbars and sheets as Liquid Glass on its own.
 *
 * Nothing is gated on this flag that the system would ignore anyway —
 * `minimizeBehavior` and the glass tab bar degrade by themselves on iOS 18.
 * It exists for the one case where we choose a *different component*: the
 * bottom toolbar is only worth frosting where the system frosts everything
 * else around it.
 */
export const hasLiquidGlass = iosVersion >= 26;

/**
 * Input styling. iOS fields sit inside a grouped card, so they take the
 * `secondary` variant to stay distinct from the card behind them (DESIGN.md
 * §4). Android fields stand on the page background and keep the default.
 */
export const fieldVariant = isIOS ? ("secondary" as const) : ("primary" as const);

/** Corner radius: iOS inset-grouped lists are rounder than Material 3 ones. */
export const groupRadiusClass = isIOS ? "rounded-2xl" : "rounded-xl";
