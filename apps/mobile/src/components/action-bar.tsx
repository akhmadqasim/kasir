import type { SFSymbol } from "expo-symbols";
import { Button, GlassView, Separator, Typography, useThemeColor } from "heroui-native";
import type { ComponentProps, JSX } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlatformIcon } from "@/components/platform-icon";
import { hasLiquidGlass, isIOS } from "@/lib/platform";

type MaterialName = ComponentProps<typeof PlatformIcon>["md"];

export interface ScreenAction {
  key: string;
  label: string;
  sf: SFSymbol;
  md: MaterialName;
  onPress: () => void;
  /** Exactly one action should be primary; it becomes the FAB on Android. */
  primary?: boolean;
  destructive?: boolean;
}

/**
 * The actions a screen offers, in the place its platform puts them.
 *
 * iOS 26 puts them in a bottom toolbar that floats over the content on a sheet
 * of glass, every action equal in weight and labelled under its symbol. Material 3
 * puts them in a bottom app bar: the secondary actions as plain icon buttons on
 * the left, and the one action the screen exists for as an extended FAB on the
 * right. Same list, same order, same handlers — only the arrangement differs, so
 * the caller passes one array and never branches.
 *
 * The bar floats, so screens using it must leave room at the bottom of their
 * scroll content (`pb-32`).
 */
export function ActionBar({ actions }: { actions: ScreenAction[] }): JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [foreground, danger, accentForeground] = useThemeColor([
    "foreground",
    "danger",
    "accent-foreground",
  ]);
  const bottom = Math.max(insets.bottom, 12);

  // A bar with nothing in it is a strip of glass over the content.
  if (actions.length === 0) return null;

  if (isIOS) {
    return (
      <View className="absolute inset-x-0 bottom-0" style={{ paddingBottom: bottom }}>
        <GlassView
          className="overflow-hidden"
          // iOS 26 frosts every bar; below it a toolbar is an opaque surface.
          forceFallbackColor={!hasLiquidGlass}
          fallbackColor="surface"
        >
          <Separator />
          <View className="flex-row items-stretch justify-around px-2 pt-2 pb-1">
            {actions.map((action) => (
              <Button
                key={action.key}
                variant="ghost"
                className="flex-1 h-auto flex-col gap-1 py-1"
                accessibilityLabel={action.label}
                onPress={action.onPress}
              >
                <PlatformIcon
                  sf={action.sf}
                  md={action.md}
                  size={22}
                  color={action.destructive ? danger : foreground}
                />
                <Typography
                  type="body-xs"
                  align="center"
                  className={action.destructive ? "text-danger" : undefined}
                >
                  {action.label}
                </Typography>
              </Button>
            ))}
          </View>
        </GlassView>
      </View>
    );
  }

  const primary = actions.find((action) => action.primary) ?? actions[0];
  const secondary = actions.filter((action) => action !== primary);

  return (
    <View
      className="absolute inset-x-0 bottom-0 flex-row items-center justify-between gap-2 bg-surface px-2 pt-2"
      style={{ paddingBottom: bottom }}
    >
      <View className="flex-row items-center gap-1">
        {secondary.map((action) => (
          <Button
            key={action.key}
            variant="ghost"
            size="lg"
            isIconOnly
            accessibilityLabel={action.label}
            onPress={action.onPress}
          >
            <PlatformIcon
              sf={action.sf}
              md={action.md}
              size={24}
              color={action.destructive ? danger : foreground}
            />
          </Button>
        ))}
      </View>

      <Button
        variant="primary"
        size="lg"
        className="rounded-2xl"
        accessibilityLabel={primary.label}
        onPress={primary.onPress}
      >
        <PlatformIcon sf={primary.sf} md={primary.md} size={20} color={accentForeground} />
        <Button.Label>{primary.label}</Button.Label>
      </Button>
    </View>
  );
}
