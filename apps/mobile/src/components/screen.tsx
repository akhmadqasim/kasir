import type { JSX, ReactNode } from "react";
import { useMemo } from "react";
import { KeyboardAvoidingView, ScrollView, View, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isAndroid, isIOS } from "@/lib/platform";

interface ScreenProps {
  children: ReactNode;
  className?: string;
  /**
   * The screen has no navigation header — a tab screen, or Login — so nothing
   * has reserved the status bar for it.
   */
  headerless?: boolean;
}

/**
 * How a scroll view inside a headerless screen keeps clear of the status bar
 * and the tab bar.
 *
 * Two halves, because the platforms answer differently. On iOS the scroll view
 * asks the system for its own insets — that single prop covers the status bar
 * at the top and the Liquid Glass tab bar at the bottom, and it is also what
 * collapses a large title. On Android `NativeTabs` wraps the screen in a
 * `SafeAreaView` that applies the *bottom* inset only, and the docs are explicit
 * that the rest is ours.
 *
 * Both halves live here so every scrollable — `ScrollScreen` and the product
 * `FlatList` alike — gets the same treatment by spreading one object.
 */
export function useHeaderlessScrollProps(
  /** Required, not defaulted: a screen that *does* have a header must not be padded past it. */
  headerless: boolean
): Pick<ScrollViewProps, "contentInsetAdjustmentBehavior" | "contentContainerStyle"> {
  const insets = useSafeAreaInsets();
  const paddingTop = headerless && isAndroid ? insets.top + 16 : 0;

  return useMemo(
    () => ({
      contentInsetAdjustmentBehavior: "automatic" as const,
      contentContainerStyle: paddingTop > 0 ? { paddingTop } : undefined,
    }),
    [paddingTop]
  );
}

/** Full-height canvas with the theme background. Lists live here. */
export function Screen({ children, className }: ScreenProps): JSX.Element {
  return <View className={`flex-1 bg-background ${className ?? ""}`}>{children}</View>;
}

/**
 * A form or detail page: scrolls, gives way to the keyboard, and keeps the page
 * padding. Content is a `gap-4` column.
 */
export function ScrollScreen({ children, className, headerless }: ScreenProps): JSX.Element {
  const scrollProps = useHeaderlessScrollProps(headerless ?? false);

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={isIOS ? "padding" : undefined}>
      <ScrollView
        className="flex-1"
        contentContainerClassName={`gap-4 px-4 py-4 ${className ?? ""}`}
        keyboardShouldPersistTaps="handled"
        // Flicking the list away to type again is the iOS reflex; Android has no equivalent.
        keyboardDismissMode={isIOS ? "interactive" : "on-drag"}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
