import { Ionicons } from "@expo/vector-icons";
import { id } from "@kasir/shared";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import type { ComponentProps, JSX } from "react";
import type { ColorValue } from "react-native";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/** There is no `index` route in this group; the scanner is the first thing a stock-taker wants. */
export const unstable_settings = {
  initialRouteName: "scan",
};

function TabIcon({ name, color }: { name: IoniconName; color: ColorValue }): JSX.Element {
  return <Ionicons name={name} size={24} color={color} />;
}

/**
 * Default Expo Router `Tabs`. `NativeTabs` (Liquid Glass on iOS 26) is not the
 * documented default in SDK 57, so it stays a later decision — see the
 * research note in the README.
 */
export default function TabsLayout(): JSX.Element {
  const [accent, muted, background] = useThemeColor(["accent", "muted", "background"]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: muted,
        headerStyle: { backgroundColor: background },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: background },
      }}
    >
      <Tabs.Screen
        name="scan"
        options={{
          title: id.nav.scan,
          tabBarIcon: ({ color }) => <TabIcon name="barcode-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: id.nav.products,
          tabBarIcon: ({ color }) => <TabIcon name="cube-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="low-stock"
        options={{
          title: id.nav.lowStock,
          tabBarIcon: ({ color }) => <TabIcon name="alert-circle-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: id.nav.settings,
          tabBarIcon: ({ color }) => <TabIcon name="settings-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
