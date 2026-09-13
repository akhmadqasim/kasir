import {
  DEFAULT_SERVER_PORT,
  id,
  normalizeServerOrigin,
  originAuthority,
  subnetLabel,
  type ProbeResult,
} from "@kasir/shared";
import {
  Alert,
  Button,
  Description,
  FieldError,
  Input,
  Label,
  ListGroup,
  Spinner,
  TextField,
  Typography,
} from "heroui-native";
import { useMemo, useState, type JSX } from "react";
import { View } from "react-native";

import { PlatformIcon } from "@/components/platform-icon";
import { ProgressBar } from "@/components/progress-bar";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { testServer, useServerDiscovery } from "@/hooks/use-server-discovery";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { fieldVariant, isIOS } from "@/lib/platform";
import { useSessionStore } from "@/stores/session-store";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; origin: string; onboardingPending: boolean | null }
  | { kind: "fail"; message: string };

/**
 * Where is the desktop POS?
 *
 * Two ways in, both ending in the same "Uji koneksi" and the same saved
 * `http://host:port`: scan the Wi-Fi for anything answering like a kasir
 * server, or type the address. The port is editable because the desktop
 * walks up from 17720 when that port is taken, and only its startup log says
 * which one it got.
 *
 * The sweep is 253 requests and takes seconds, so it is drawn as work in
 * progress — the subnet being walked, a bar, and a count — rather than as a
 * spinner that could equally mean the app has hung.
 */
export default function ServerSetupScreen(): JSX.Element {
  const currentOrigin = useSessionStore((state) => state.serverOrigin);
  const setServerOrigin = useSessionStore((state) => state.setServerOrigin);
  const setChangingServer = useSessionStore((state) => state.setChangingServer);

  const [manual, setManual] = useState(currentOrigin ? originAuthority(currentOrigin) : "");
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT));
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const discovery = useServerDiscovery();

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535;
  const scanning = discovery.state.status === "scanning";
  // The progress line re-renders once per probed host — 253 times a scan — and
  // the address it names never changes while that runs.
  const ownIp = discovery.state.ownIp;
  const subnet = useMemo(() => (ownIp ? subnetLabel(ownIp) : null), [ownIp]);

  const runTest = async (candidate: string) => {
    const origin = normalizeServerOrigin(candidate);
    if (!origin) {
      hapticWarning();
      setTest({ kind: "fail", message: id.server.invalidUrl });
      return;
    }
    setTest({ kind: "testing" });
    const result = await testServer(origin);
    if (result.ok) {
      hapticSuccess();
      setTest({ kind: "ok", origin, onboardingPending: result.onboardingPending });
    } else {
      hapticWarning();
      setTest({ kind: "fail", message: id.server.testFail });
    }
  };

  const pick = (result: ProbeResult) => {
    hapticSuccess();
    setManual(originAuthority(result.origin));
    setTest({ kind: "ok", origin: result.origin, onboardingPending: result.onboardingPending });
  };

  const save = () => {
    if (test.kind !== "ok") return;
    discovery.cancel();
    setServerOrigin(test.origin);
  };

  const cancelChange = () => {
    discovery.cancel();
    setChangingServer(false);
  };

  return (
    <ScrollScreen className="pb-8">
      <Typography.Paragraph color="muted">{id.server.description}</Typography.Paragraph>

      <Section title={id.server.discover} variant="fields">
        <TextField isInvalid={!portValid}>
          <Label>{id.server.portLabel}</Label>
          <Input
            variant={fieldVariant}
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            placeholder={String(DEFAULT_SERVER_PORT)}
            maxLength={5}
          />
          {portValid ? null : <FieldError>{id.common.invalidNumber}</FieldError>}
        </TextField>

        <Button
          variant="secondary"
          isDisabled={!portValid}
          onPress={() => (scanning ? discovery.cancel() : void discovery.start(portNumber))}
        >
          {scanning ? (
            <Button.Label>{id.common.cancel}</Button.Label>
          ) : (
            <>
              <PlatformIcon sf="wifi" md="wifi" size={18} />
              <Button.Label>{id.server.discover}</Button.Label>
            </>
          )}
        </Button>

        {scanning ? (
          <View className="gap-2">
            <ProgressBar
              value={discovery.state.total === 0 ? 0 : discovery.state.done / discovery.state.total}
              accessibilityLabel={id.server.discovering}
            />
            <Typography type="body-sm" color="muted">
              {`${id.server.discoverSubnet} ${subnet ?? "—"} · ${discovery.state.done}/${discovery.state.total}`}
            </Typography>
          </View>
        ) : null}

        {discovery.state.status === "no_network" ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{id.server.discoverNoNetwork}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {discovery.state.status === "done" && discovery.state.found.length === 0 ? (
          <Typography type="body-sm" color="muted">
            {id.server.discoverNone}
          </Typography>
        ) : null}
      </Section>

      {discovery.state.found.length > 0 ? (
        <Section title={id.server.discoverFound} variant="rows">
          {discovery.state.found.map((result) => (
            <ListGroup.Item
              key={result.origin}
              onPress={() => pick(result)}
              accessibilityRole="button"
              accessibilityLabel={originAuthority(result.origin)}
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{originAuthority(result.origin)}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {result.onboardingPending
                    ? `${id.server.detected} · ${id.server.needsOnboarding}`
                    : id.server.detected}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
          ))}
        </Section>
      ) : null}

      <Section title={id.server.manualSection} variant="fields">
        <TextField isInvalid={test.kind === "fail"}>
          <Label>{id.server.manualLabel}</Label>
          <Input
            variant={fieldVariant}
            value={manual}
            onChangeText={(value) => {
              setManual(value);
              if (test.kind !== "idle") setTest({ kind: "idle" });
            }}
            placeholder={id.server.manualPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            // iOS's url keyboard puts `.` and `:` a tap away and keeps letters
            // for hostnames; Android's default keyboard already does both.
            keyboardType={isIOS ? "url" : "default"}
            returnKeyType="go"
            onSubmitEditing={() => void runTest(manual)}
          />
          {test.kind === "fail" ? (
            <FieldError>{test.message}</FieldError>
          ) : (
            <Description>{id.server.manualHint}</Description>
          )}
        </TextField>

        <Button
          variant="secondary"
          isDisabled={manual.trim().length === 0 || test.kind === "testing"}
          onPress={() => void runTest(manual)}
        >
          {test.kind === "testing" ? (
            <Spinner size="sm" />
          ) : (
            <Button.Label>{id.server.test}</Button.Label>
          )}
        </Button>
      </Section>

      {test.kind === "ok" ? (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{id.server.testOk}</Alert.Title>
            <Alert.Description>
              {test.onboardingPending
                ? `${originAuthority(test.origin)} · ${id.server.needsOnboarding}`
                : originAuthority(test.origin)}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <Button isDisabled={test.kind !== "ok"} onPress={save}>
        {id.server.save}
      </Button>

      {currentOrigin ? (
        <Button variant="ghost" onPress={cancelChange}>
          {id.common.cancel}
        </Button>
      ) : null}
    </ScrollScreen>
  );
}
