import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

interface FieldRowProps {
  label: string;
  value: string;
  /** For the number that matters most on the screen. */
  emphasize?: boolean;
  danger?: boolean;
}

/** Label left, value right — one fact per line, no decoration (DESIGN.md §9). */
export function FieldRow({ label, value, emphasize, danger }: FieldRowProps): JSX.Element {
  return (
    <View className="flex-row items-baseline justify-between gap-4 py-2">
      <Typography type="body-sm" color="muted">
        {label}
      </Typography>
      <Typography
        type={emphasize ? "h5" : "body"}
        weight={emphasize ? "semibold" : undefined}
        align="end"
        className={`flex-1 ${danger ? "text-danger" : ""}`}
      >
        {value}
      </Typography>
    </View>
  );
}
