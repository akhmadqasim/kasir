import { id, originAuthority, roleLabel } from "@kasir/shared";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Button, ListGroup, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { Alert as NativeAlert } from "react-native";

import { PageHeader } from "@/components/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { useCurrentUser, useLogout } from "@/hooks/use-session";
import { useSessionStore } from "@/stores/session-store";

/**
 * Which server, who is logged in, and the way out.
 *
 * Logging out is destructive enough to confirm, and `Alert.alert` is already the
 * right control on both platforms — an action sheet on iOS, a Material dialog on
 * Android — so there is nothing to write ourselves.
 */
export default function SettingsTab(): JSX.Element {
  const router = useRouter();
  const user = useCurrentUser();
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const setChangingServer = useSessionStore((state) => state.setChangingServer);
  const logout = useLogout();

  const confirmLogout = () => {
    NativeAlert.alert(id.auth.logout, id.settings.logoutConfirm, [
      { text: id.common.cancel, style: "cancel" },
      { text: id.auth.logout, style: "destructive", onPress: () => logout.mutate() },
    ]);
  };

  return (
    <ScrollScreen headerless>
      <PageHeader title={id.settings.title} />

      <Section title={id.settings.server} variant="rows">
        <ListGroup.Item
          accessibilityRole="button"
          accessibilityLabel={id.server.change}
          onPress={() => {
            setChangingServer(true);
            router.push("/server-setup");
          }}
        >
          <ListGroup.ItemPrefix>
            <PlatformIcon sf="desktopcomputer" md="desktop-tower-monitor" size={20} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>
              {serverOrigin ? originAuthority(serverOrigin) : "—"}
            </ListGroup.ItemTitle>
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
            <Typography color="muted">{Constants.expoConfig?.version ?? "—"}</Typography>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </Section>

      <Button variant="danger-soft" isDisabled={logout.isPending} onPress={confirmLogout}>
        {logout.isPending ? <Spinner size="sm" /> : <Button.Label>{id.auth.logout}</Button.Label>}
      </Button>
    </ScrollScreen>
  );
}
