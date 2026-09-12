import { errorMessage, id } from "@kasir/shared";
import { Alert, Button, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

/** Centered spinner for a screen that has nothing to show yet. */
export function LoadingView(): JSX.Element {
  return (
    <View className="flex-1 items-center justify-center py-12">
      <Spinner />
    </View>
  );
}

interface EmptyViewProps {
  message?: string;
}

/** DESIGN.md §5.6: a short sentence, centered, nothing else. */
export function EmptyView({ message = id.common.noData }: EmptyViewProps): JSX.Element {
  return (
    <View className="flex-1 items-center justify-center py-12 px-6">
      <Typography.Paragraph color="muted" align="center">
        {message}
      </Typography.Paragraph>
    </View>
  );
}

interface ErrorViewProps {
  error: unknown;
  onRetry?: () => void;
}

/**
 * The `ApiError` message is already Indonesian and written for the screen;
 * `Database`/`Internal` messages are redacted on the server.
 */
export function ErrorView({ error, onRetry }: ErrorViewProps): JSX.Element {
  return (
    <View className="gap-4 py-4">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{id.common.error}</Alert.Title>
          <Alert.Description>{errorMessage(error)}</Alert.Description>
        </Alert.Content>
      </Alert>
      {onRetry ? (
        <Button variant="secondary" onPress={onRetry}>
          {id.common.retry}
        </Button>
      ) : null}
    </View>
  );
}

interface InlineErrorProps {
  error: unknown | null;
}

/** A form's error line, rendered only when there is one. */
export function InlineError({ error }: InlineErrorProps): JSX.Element | null {
  if (!error) return null;
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{errorMessage(error)}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
