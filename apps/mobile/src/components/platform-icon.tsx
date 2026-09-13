import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ComponentProps, JSX } from "react";

import { hasSfSymbols } from "@/lib/native-modules";

type MaterialName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface PlatformIconProps {
  /** SF Symbol name, used on iOS when the symbol renderer is available. */
  sf: SFSymbol;
  /** Material Community icon name, used everywhere else — and as the iOS fallback. */
  md: MaterialName;
  size?: number;
  color?: string;
}

/**
 * One icon, two icon languages.
 *
 * A phone user reads an icon by its silhouette, and the silhouettes SF Symbols
 * and Material use for the same idea are different enough that borrowing one
 * for the other platform is what makes an app feel ported. Every caller names
 * both, so the choice is made at the definition and never at the call site.
 *
 * When `expo-symbols` is not in the build, or the symbol name is one this iOS
 * does not know, the Material icon is drawn instead — a font glyph, which
 * always renders. An icon button that draws nothing is worse than one drawn in
 * the wrong dialect: the user cannot see that there is a button at all.
 */
export function PlatformIcon({ sf, md, size = 22, color }: PlatformIconProps): JSX.Element {
  const fallback = <MaterialCommunityIcons name={md} size={size} color={color} />;
  if (!hasSfSymbols) return fallback;

  return (
    <SymbolView
      name={sf}
      size={size}
      tintColor={color}
      style={{ width: size, height: size }}
      fallback={fallback}
    />
  );
}
