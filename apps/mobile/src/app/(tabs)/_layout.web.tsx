import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { id } from "@kasir/shared";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";
import type { ComponentProps, JSX } from "react";
import type { ColorValue } from "react-native";

type MaterialName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export const unstable_settings = {
  initialRouteName: "scan",
};

function TabIcon({ name, color }: { name: MaterialName; color: ColorValue }): JSX.Element {
  return <MaterialCommunityIcons name={name} size={24} color={color} />;
}

/**
 * Web fallback for `(tabs)/_layout.tsx`.
 *
 * The Expo docs name web as the one platform where `NativeTabs` has only a basic
 * implementation and recommend a `.web.tsx` layout instead — so this is the JS
 * `Tabs` navigator, unchanged from before native tabs. Nothing on iOS or Android
 * takes this path: there, `NativeTabs` is the real system tab bar and ships in
 * Expo Go.
 */
export default function TabsLayoutWeb(): JSX.Element {
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
          tabBarIcon: ({ color }) => <TabIcon name="barcode-scan" color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: id.nav.products,
          tabBarIcon: ({ color }) => <TabIcon name="package-variant-closed" color={color} />,
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
          tabBarIcon: ({ color }) => <TabIcon name="cog-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
