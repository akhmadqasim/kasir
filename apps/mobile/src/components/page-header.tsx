import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { isIOS } from "@/lib/platform";

interface PageHeaderProps {
  title: string;
  /** One muted line under the title — what the screen is for, not a slogan. */
  subtitle?: string;
}

/**
 * The title of a tab screen.
 *
 * `NativeTabs` deliberately gives its screens no navigation header, so the title
 * is content — which is also what iOS wants, since a large title is supposed to
 * scroll away with the list under it. iOS gets that large title; Android gets the
 * smaller, heavier line of a Material 3 top app bar.
 */
export function PageHeader({ title, subtitle }: PageHeaderProps): JSX.Element {
  return (
    <View className="gap-1">
      <Typography.Heading
        type={isIOS ? "h1" : "h4"}
        weight={isIOS ? "bold" : "medium"}
        numberOfLines={1}
      >
        {title}
      </Typography.Heading>
      {subtitle ? (
        <Typography type="body-sm" color="muted">
          {subtitle}
        </Typography>
      ) : null}
    </View>
  );
}
