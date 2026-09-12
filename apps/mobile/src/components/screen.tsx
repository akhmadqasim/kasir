import type { JSX, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

interface ScreenProps {
  children: ReactNode;
  className?: string;
}

/** Full-height canvas with the theme background and the page padding. */
export function Screen({ children, className }: ScreenProps): JSX.Element {
  return <View className={`flex-1 bg-background px-4 ${className ?? ""}`}>{children}</View>;
}

/**
 * A form or detail page: scrolls, gives way to the keyboard, and keeps the
 * same padding as {@link Screen}. Content is a `gap-4` column.
 */
export function ScrollScreen({ children, className }: ScreenProps): JSX.Element {
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName={`gap-4 px-4 py-4 ${className ?? ""}`}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
