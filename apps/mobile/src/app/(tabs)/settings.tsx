import { id, originAuthority, roleLabel } from "@kasir/shared";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Button, ListGroup, Separator, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { Alert as NativeAlert, View } from "react-native";

import { ScrollScreen } from "@/components/screen";
import { useCurrentUser, useLogout } from "@/hooks/use-session";
import { useSessionStore } from "@/stores/session-store";

/** Which server, who is logged in, and the way out. */
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
    <ScrollScreen>
      <View className="gap-2">
        <Typography type="body-sm" color="muted" className="ml-2">
          {id.settings.server}
        </Typography>
        <ListGroup>
          <ListGroup.Item
            onPress={() => {
              setChangingServer(true);
              router.push("/server-setup");
            }}
          >
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>
                {serverOrigin ? originAuthority(serverOrigin) : "—"}
              </ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{id.server.change}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        </ListGroup>
      </View>

      <View className="gap-2">
        <Typography type="body-sm" color="muted" className="ml-2">
          {id.settings.account}
        </Typography>
        <ListGroup>
          <ListGroup.Item disabled>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{user.full_name}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{user.username}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
          </ListGroup.Item>
          <Separator className="mx-4" />
          <ListGroup.Item disabled>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{id.settings.role}</ListGroup.ItemTitle>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <Typography color="muted">{roleLabel(user.role)}</Typography>
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        </ListGroup>
      </View>

      <View className="gap-2">
        <Typography type="body-sm" color="muted" className="ml-2">
          {id.settings.about}
        </Typography>
        <ListGroup>
          <ListGroup.Item disabled>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{id.settings.version}</ListGroup.ItemTitle>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <Typography color="muted">{Constants.expoConfig?.version ?? "—"}</Typography>
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        </ListGroup>
      </View>

      <Button variant="danger-soft" isDisabled={logout.isPending} onPress={confirmLogout}>
        {logout.isPending ? <Spinner size="sm" /> : <Button.Label>{id.auth.logout}</Button.Label>}
      </Button>
    </ScrollScreen>
  );
}
