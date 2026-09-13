import type { JSX } from "react";
import { View } from "react-native";

import { isIOS } from "@/lib/platform";

interface ProgressBarProps {
  /** 0–1. Values outside the range are clamped rather than drawn past the track. */
  value: number;
  accessibilityLabel: string;
}

/**
 * A determinate bar for the one thing in this app that takes measurable time:
 * knocking on 253 hosts to find the till.
 *
 * HeroUI Native has no progress component, so this is built from its tokens —
 * a track on `default`, a fill on `accent`. iOS draws a hairline bar; Material 3
 * a slightly thicker one with rounded ends.
 */
export function ProgressBar({ value, accessibilityLabel }: ProgressBarProps): JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className={`w-full overflow-hidden rounded-full bg-default ${isIOS ? "h-1" : "h-1.5"}`}
    >
      <View className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </View>
  );
}
