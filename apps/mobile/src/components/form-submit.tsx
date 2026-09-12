import { Stack } from "expo-router";
import { Button, Spinner } from "heroui-native";
import type { JSX } from "react";

import { isIOS } from "@/lib/platform";

interface FormSubmitProps {
  label: string;
  isDisabled: boolean;
  isPending: boolean;
  /** A write-off records a loss; both platforms colour that action as destructive. */
  destructive?: boolean;
  onPress: () => void;
}

/** The label, or a spinner in its place while the request is in flight. */
function SubmitContent({ label, isPending }: { label: string; isPending: boolean }): JSX.Element {
  return isPending ? <Spinner size="sm" /> : <Button.Label>{label}</Button.Label>;
}

/**
 * The one action a form screen has, in the place its own platform puts it.
 *
 * iOS puts it in the navigation bar as a "Done"-style trailing item — the one
 * control HIG allows that bar — so it is reachable without scrolling past every
 * field. Material 3 does not put a form's primary action in the top app bar: it
 * is a filled button at the end of the form, and Android keeps it exactly there.
 *
 * Rendered as the last child of the form either way; on iOS it draws nothing and
 * only sets the screen's options.
 */
export function FormSubmit({
  label,
  isDisabled,
  isPending,
  destructive = false,
  onPress,
}: FormSubmitProps): JSX.Element {
  if (isIOS) {
    return (
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button
              variant={destructive ? "danger-soft" : "ghost"}
              size="sm"
              isDisabled={isDisabled || isPending}
              accessibilityLabel={label}
              onPress={onPress}
            >
              <SubmitContent label={label} isPending={isPending} />
            </Button>
          ),
        }}
      />
    );
  }

  return (
    <Button
      variant={destructive ? "danger" : "primary"}
      isDisabled={isDisabled || isPending}
      onPress={onPress}
    >
      <SubmitContent label={label} isPending={isPending} />
    </Button>
  );
}
