import { id, originAuthority } from "@kasir/shared";
import { useRouter } from "expo-router";
import { Button, Description, Input, Label, Spinner, TextField, Typography } from "heroui-native";
import { useRef, useState, type JSX } from "react";
import { View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScrollScreen } from "@/components/screen";
import { InlineError } from "@/components/state-view";
import { useLogin } from "@/hooks/use-session";
import { useSessionStore } from "@/stores/session-store";

const PIN_PATTERN = /^\d{4,6}$/;

/**
 * Username + PIN. The PIN field is numeric and hidden; "done" on the keyboard
 * submits. The error line is the server's `message`, which is already the
 * sentence to show — wrong PIN, locked out for N seconds, server unreachable.
 */
export default function LoginScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const serverOrigin = useSessionStore((state) => state.serverOrigin);
  const setChangingServer = useSessionStore((state) => state.setChangingServer);
  const router = useRouter();
  const login = useLogin();

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const pinRef = useRef<TextInput>(null);

  const canSubmit = username.trim().length > 0 && PIN_PATTERN.test(pin) && !login.isPending;

  const submit = () => {
    if (!canSubmit) return;
    login.mutate(
      { username: username.trim(), pin },
      {
        // Never keep a PIN around longer than the request that used it.
        onSettled: () => setPin(""),
      }
    );
  };

  return (
    <ScrollScreen className="justify-center flex-grow">
      <View style={{ paddingTop: insets.top }} className="gap-2 mb-4">
        <Typography.Heading type="h2">{id.auth.loginTitle}</Typography.Heading>
        {serverOrigin ? (
          <Typography type="body-sm" color="muted">
            {originAuthority(serverOrigin)}
          </Typography>
        ) : null}
      </View>

      <TextField isRequired>
        <Label>{id.auth.username}</Label>
        <Input
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => pinRef.current?.focus()}
          blurOnSubmit={false}
        />
      </TextField>

      <TextField isRequired isInvalid={login.isError}>
        <Label>{id.auth.pin}</Label>
        <Input
          ref={pinRef}
          value={pin}
          onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          autoComplete="off"
          textContentType="oneTimeCode"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Description>{id.auth.pinHint}</Description>
      </TextField>

      <InlineError error={login.error} />

      <Button isDisabled={!canSubmit} onPress={submit}>
        {login.isPending ? (
          <Spinner size="sm" />
        ) : (
          <Button.Label>{id.auth.loginButton}</Button.Label>
        )}
      </Button>

      <Button
        variant="ghost"
        onPress={() => {
          setChangingServer(true);
          router.push("/server-setup");
        }}
      >
        {id.server.change}
      </Button>
    </ScrollScreen>
  );
}
