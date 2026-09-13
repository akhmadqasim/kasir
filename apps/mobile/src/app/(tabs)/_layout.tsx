import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { id } from "@kasir/shared";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useThemeColor } from "heroui-native";
import type { JSX } from "react";

/** There is no `index` route in this group; the scanner is the first thing a stock-taker wants. */
export const unstable_settings = {
  initialRouteName: "scan",
};

/**
 * The system tab bar, not a drawing of one.
 *
 * `NativeTabs` renders UIKit's tab bar on iOS and Material 3's navigation bar on
 * Android, and it ships inside Expo Go — so the phone the shop owner is holding
 * gets the real thing without a dev client. On iOS 26 that tab bar is Liquid
 * Glass and tints itself from whatever scrolls under it, which is why no
 * `backgroundColor` is set here: on iOS 26 the prop is ignored, and on iOS 18 the
 * system's own material is still the right answer.
 *
 * `minimizeBehavior="onScrollDown"` is iOS 26 only and ignored below it, so there
 * is nothing to feature-detect. The one platform the docs call unsupported is
 * web, which gets `_layout.web.tsx` — the JS `Tabs` this file used to be.
 *
 * Android is capped at five tabs; this app has four.
 */
export default function TabsLayout(): JSX.Element {
  const [accent, muted, accentSoft] = useThemeColor(["accent", "muted", "accent-soft"]);

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      iconColor={{ default: muted, selected: accent }}
      labelStyle={{ default: { color: muted }, selected: { color: accent } }}
      // Material 3: the pill behind the selected icon, and the touch ripple.
      indicatorColor={accentSoft}
      rippleColor={accentSoft}
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="scan">
        <NativeTabs.Trigger.Icon
          sf="barcode.viewfinder"
          src={
            <NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name="barcode-scan" />
          }
        />
        <NativeTabs.Trigger.Label>{id.nav.scan}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Icon
          sf={{ default: "shippingbox", selected: "shippingbox.fill" }}
          src={
            <NativeTabs.Trigger.VectorIcon
              family={MaterialCommunityIcons}
              name="package-variant-closed"
            />
          }
        />
        <NativeTabs.Trigger.Label>{id.nav.products}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="low-stock">
        <NativeTabs.Trigger.Icon
          sf={{ default: "exclamationmark.triangle", selected: "exclamationmark.triangle.fill" }}
          src={
            <NativeTabs.Trigger.VectorIcon
              family={MaterialCommunityIcons}
              name="alert-circle-outline"
            />
          }
        />
        <NativeTabs.Trigger.Label>{id.nav.lowStock}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name="cog-outline" />}
        />
        <NativeTabs.Trigger.Label>{id.nav.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
