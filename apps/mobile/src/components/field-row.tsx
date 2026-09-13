import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

/**
 * Digits of equal width. Without it a right-aligned column of rupiah shifts
 * sideways every time the number changes (root `DESIGN.md` §3.4).
 */
const TABULAR = { fontVariant: ["tabular-nums" as const] };

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
    <View className="flex-row items-baseline justify-between gap-4 py-2.5">
      <Typography type="body-sm" color="muted">
        {label}
      </Typography>
      <Typography
        type={emphasize ? "h5" : "body"}
        weight={emphasize ? "semibold" : undefined}
        align="end"
        style={TABULAR}
        className={`flex-1 ${danger ? "text-danger" : ""}`}
      >
        {value}
      </Typography>
    </View>
  );
}
