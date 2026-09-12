import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ComponentProps, JSX } from "react";

import { isIOS } from "@/lib/platform";

type MaterialName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface PlatformIconProps {
  /** SF Symbol name, used on iOS. */
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
 * `SymbolView` falls back to the Material icon when a symbol is missing (an
 * older iOS that does not know the name), so nothing renders blank.
 */
export function PlatformIcon({ sf, md, size = 22, color }: PlatformIconProps): JSX.Element {
  if (isIOS) {
    return (
      <SymbolView
        name={sf}
        size={size}
        tintColor={color}
        style={{ width: size, height: size }}
        fallback={<MaterialCommunityIcons name={md} size={size} color={color} />}
      />
    );
  }
  return <MaterialCommunityIcons name={md} size={size} color={color} />;
}
