import { id, originAuthority, roleLabel } from "@kasir/shared";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Button, ListGroup, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { Alert as NativeAlert, View } from "react-native";

import { NativeSettingsList } from "@/components/native-list";
import { PageHeader } from "@/components/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { Screen, ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { useCurrentUser, useLogout } from "@/hooks/use-session";
import { hasSwiftUI } from "@/lib/native-modules";
import { useSessionStore } from "@/stores/session-store";

/**
 * Which server, who is logged in, and the way out.
 *
 * On iOS this is a SwiftUI `List` — the same grouped form every Settings screen
 * on the phone uses, down to the red destructive row. Android gets the Material 3
 * equivalent. Confirming the logout is `Alert.alert` either way: already an
 * action sheet on iOS and a Material dialog on Android, so there is nothing to
 * write ourselves.
 */
export default function SettingsTab(): JSX.Element {
  const router = useRouter();
  const user = useCurrentUser();
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const setChangingServer = useSessionStore((state) => state.setChangingServer);
  const logout = useLogout();

  const serverAuthority = serverOrigin ? originAuthority(serverOrigin) : "—";
  const appVersion = Constants.expoConfig?.version ?? "—";

  const changeServer = () => {
    setChangingServer(true);
    router.push("/server-setup");
  };

  const confirmLogout = () => {
    NativeAlert.alert(id.auth.logout, id.settings.logoutConfirm, [
      { text: id.common.cancel, style: "cancel" },
      { text: id.auth.logout, style: "destructive", onPress: () => logout.mutate() },
    ]);
  };

  if (hasSwiftUI) {
    return (
      <Screen>
        {/* No Android inset to add here: `hasSwiftUI` is iOS-only, and the
            SwiftUI `List` below applies the safe area itself. */}
        <View className="px-4 pb-2">
          <PageHeader title={id.settings.title} />
        </View>
        <NativeSettingsList
          user={user}
          serverAuthority={serverAuthority}
          appVersion={appVersion}
          onChangeServer={changeServer}
          onLogout={confirmLogout}
          isLoggingOut={logout.isPending}
        />
      </Screen>
    );
  }

  return (
    <ScrollScreen headerless>
      <PageHeader title={id.settings.title} />

      <Section title={id.settings.server} variant="rows">
        <ListGroup.Item
          accessibilityRole="button"
          accessibilityLabel={id.server.change}
          onPress={changeServer}
        >
          <ListGroup.ItemPrefix>
            <PlatformIcon sf="desktopcomputer" md="desktop-tower-monitor" size={20} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{serverAuthority}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{id.server.change}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </Section>

      <Section title={id.settings.account} variant="rows">
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <PlatformIcon sf="person.crop.circle" md="account-circle-outline" size={20} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{user.full_name}</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{user.username}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{id.settings.role}</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <Typography color="muted">{roleLabel(user.role)}</Typography>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </Section>

      <Section title={id.settings.about} variant="rows">
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{id.settings.version}</ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <Typography color="muted">{appVersion}</Typography>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </Section>

      <Button variant="danger-soft" isDisabled={logout.isPending} onPress={confirmLogout}>
        {logout.isPending ? <Spinner size="sm" /> : <Button.Label>{id.auth.logout}</Button.Label>}
      </Button>
    </ScrollScreen>
  );
}
