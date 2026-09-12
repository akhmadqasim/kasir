import { id } from "@kasir/shared";
import type { SFSymbol } from "expo-symbols";
import { Button, useThemeColor } from "heroui-native";
import type { ComponentProps, JSX } from "react";
import { ActionSheetIOS, View } from "react-native";

import { PlatformIcon } from "@/components/platform-icon";
import { isIOS } from "@/lib/platform";

type MaterialName = ComponentProps<typeof PlatformIcon>["md"];

export interface HeaderAction {
  key: string;
  label: string;
  sf: SFSymbol;
  md: MaterialName;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * A screen's actions, in the bar that already holds its title — and in the
 * number each platform's guideline actually allows there.
 *
 * They diverge, so this does too. HIG wants a navigation bar to carry the
 * title, the back button and **one** control; more than that crowds it, and
 * three unlabelled glyphs in a row is Material's arithmetic, not Apple's. So
 * iOS gets a single trailing control: the action itself when there is one, and
 * otherwise an `ellipsis.circle` opening an action sheet where every action has
 * its name spelled out — which a stock tool wants anyway, since "Hitung Stok"
 * and "Write-off" are not obvious as icons.
 *
 * Material 3's top app bar is specified the other way: up to three high-frequency
 * action icons before anything needs an overflow menu. Android shows them.
 *
 * This replaced a floating bottom toolbar, which on a tab screen was a second
 * bar stacked on the tab bar — something HIG calls out directly — and which
 * covered the numbers the screen exists to show.
 */
export function HeaderActions({ actions }: { actions: HeaderAction[] }): JSX.Element | null {
  const [foreground, danger] = useThemeColor(["foreground", "danger"]);
  if (actions.length === 0) return null;

  const showSheet = () => {
    const labels = actions.map((action) => action.label);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, id.common.cancel],
        cancelButtonIndex: labels.length,
        destructiveButtonIndex: actions.findIndex((action) => action.destructive),
      },
      (index) => actions[index]?.onPress()
    );
  };

  const inline = isIOS && actions.length > 1 ? [] : actions;

  return (
    <View className="flex-row items-center gap-1">
      {inline.map((action) => (
        <Button
          key={action.key}
          variant="ghost"
          size="sm"
          isIconOnly
          accessibilityLabel={action.label}
          onPress={action.onPress}
        >
          <PlatformIcon
            sf={action.sf}
            md={action.md}
            size={20}
            color={action.destructive ? danger : foreground}
          />
        </Button>
      ))}

      {inline.length === 0 ? (
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          accessibilityLabel={id.products.sectionActions}
          onPress={showSheet}
        >
          <PlatformIcon sf="ellipsis.circle" md="dots-vertical" size={20} color={foreground} />
        </Button>
      ) : null}
    </View>
  );
}
