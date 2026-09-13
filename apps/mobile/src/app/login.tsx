import { id, originAuthority } from "@kasir/shared";
import { useRouter } from "expo-router";
import { Button, Description, Input, Label, Spinner, TextField, Typography } from "heroui-native";
import { useRef, useState, type JSX } from "react";
import { View, type TextInput } from "react-native";

import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { InlineError } from "@/components/state-view";
import { useLogin } from "@/hooks/use-session";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { fieldVariant, isIOS } from "@/lib/platform";
import { useSessionStore } from "@/stores/session-store";

const PIN_PATTERN = /^\d{4,6}$/;

/**
 * Username + PIN. The PIN field is numeric and hidden; "done" on the keyboard
 * submits. The error line is the server's `message`, which is already the
 * sentence to show — wrong PIN, locked out for N seconds, server unreachable.
 *
 * Which till this phone is about to sign in to is a secondary fact, so it sits
 * under the title as one muted line with the way to change it next to it — not
 * as a field someone could mistake for part of the login.
 */
export default function LoginScreen(): JSX.Element {
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
        onSuccess: () => hapticSuccess(),
        onError: () => hapticWarning(),
        // Never keep a PIN around longer than the request that used it.
        onSettled: () => setPin(""),
      }
    );
  };

  return (
    <ScrollScreen className="justify-center flex-grow" headerless>
      <View className="gap-1 mb-2">
        <Typography.Heading type={isIOS ? "h1" : "h2"} weight={isIOS ? "bold" : "semibold"}>
          {id.auth.loginTitle}
        </Typography.Heading>
        {serverOrigin ? (
          <View className="flex-row items-center gap-2">
            <Typography type="body-sm" color="muted">
              {originAuthority(serverOrigin)}
            </Typography>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0"
              onPress={() => {
                setChangingServer(true);
                router.push("/server-setup");
              }}
            >
              <Button.Label>{id.server.change}</Button.Label>
            </Button>
          </View>
        ) : null}
      </View>

      <Section variant="fields">
        <TextField isRequired>
          <Label>{id.auth.username}</Label>
          <Input
            variant={fieldVariant}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => pinRef.current?.focus()}
            submitBehavior="submit"
          />
        </TextField>

        <TextField isRequired isInvalid={login.isError}>
          <Label>{id.auth.pin}</Label>
          <Input
            variant={fieldVariant}
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
      </Section>

      <InlineError error={login.error} />

      <Button isDisabled={!canSubmit} onPress={submit}>
        {login.isPending ? (
          <Spinner size="sm" />
        ) : (
          <Button.Label>{id.auth.loginButton}</Button.Label>
        )}
      </Button>
    </ScrollScreen>
  );
}
