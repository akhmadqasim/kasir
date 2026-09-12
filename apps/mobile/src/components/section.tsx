import { Separator, Surface, Typography } from "heroui-native";
import { Children, Fragment, isValidElement, type JSX, type ReactNode } from "react";
import { View } from "react-native";

import { groupRadiusClass, isIOS } from "@/lib/platform";

/**
 * What the group holds, which decides its padding and whether its rows are
 * separated.
 *
 * - `facts` — `FieldRow`s: label left, value right. Hairlines between them on
 *   iOS, nothing on Android.
 * - `fields` — form controls, which carry their own labels and need air between
 *   them rather than a line.
 * - `rows` — `ListGroup.Item`s, which bring their own padding; the group only
 *   supplies the surface and, on iOS, the hairlines.
 */
export type SectionVariant = "facts" | "fields" | "rows";

interface SectionProps {
  /** Section heading. Outside the group on iOS, tinted on Android. */
  title?: string;
  variant?: SectionVariant;
  children: ReactNode;
}

/**
 * The line above a group. Grey and unemphasised on iOS, tinted and slightly
 * heavier on Android — Material 3 uses the accent colour to mark a section.
 */
function SectionHeading({ children }: { children: string }): JSX.Element {
  return (
    <Typography
      type="body-sm"
      color={isIOS ? "muted" : "default"}
      className={isIOS ? "ml-4" : "ml-1 text-accent"}
      weight={isIOS ? undefined : "medium"}
    >
      {children}
    </Typography>
  );
}

const SURFACE_CLASS: Record<SectionVariant, string> = {
  facts: "px-4 py-1",
  fields: "gap-4 px-4 py-4",
  rows: "overflow-hidden",
};

/**
 * A grouped block — the shape both platforms use for "a few related facts or
 * fields", and the one place their list styling actually diverges.
 *
 * iOS draws an inset-grouped list: a small grey heading outside the card,
 * hairline separators between rows, generous corners. Material 3 draws the same
 * rows on a surface with no dividers at all and a tinted heading. Only those two
 * details differ, so this is one component with platform tokens rather than two
 * files (`apps/mobile/DESIGN.md` §0) — and it is the *only* place the separator
 * rule is written down, so no screen can drift into drawing iOS hairlines on
 * Android.
 */
export function Section({ title, variant = "facts", children }: SectionProps): JSX.Element {
  const items = Children.toArray(children);
  const divided = isIOS && variant !== "fields";

  return (
    <View className="gap-2">
      {title ? <SectionHeading>{title}</SectionHeading> : null}

      <Surface className={`${groupRadiusClass} ${SURFACE_CLASS[variant]}`}>
        {items.map((child, index) => (
          <Fragment key={isValidElement(child) && child.key !== null ? child.key : index}>
            {divided && index > 0 ? <Separator /> : null}
            {child}
          </Fragment>
        ))}
      </Surface>
    </View>
  );
}
