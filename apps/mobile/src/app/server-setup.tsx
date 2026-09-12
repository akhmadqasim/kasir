import {
  DEFAULT_SERVER_PORT,
  id,
  normalizeServerOrigin,
  originAuthority,
  type ProbeResult,
} from "@kasir/shared";
import {
  Alert,
  Button,
  Card,
  Description,
  Input,
  Label,
  ListGroup,
  Separator,
  Spinner,
  TextField,
  Typography,
} from "heroui-native";
import { useState, type JSX } from "react";
import { View } from "react-native";

import { ScrollScreen } from "@/components/screen";
import { testServer, useServerDiscovery } from "@/hooks/use-server-discovery";
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

  const runTest = async (candidate: string) => {
    const origin = normalizeServerOrigin(candidate);
    if (!origin) {
      setTest({ kind: "fail", message: id.server.invalidUrl });
      return;
    }
    setTest({ kind: "testing" });
    const result = await testServer(origin);
    setTest(
      result.ok
        ? { kind: "ok", origin, onboardingPending: result.onboardingPending }
        : { kind: "fail", message: id.server.testFail }
    );
  };

  const pick = (result: ProbeResult) => {
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
    <ScrollScreen>
      <Typography.Paragraph color="muted">{id.server.description}</Typography.Paragraph>

      <Card>
        <Card.Body className="gap-4">
          <Card.Title>{id.server.discover}</Card.Title>
          <TextField>
            <Label>{id.server.portLabel}</Label>
            <Input
              value={port}
              onChangeText={setPort}
              keyboardType="number-pad"
              isInvalid={!portValid}
              placeholder={String(DEFAULT_SERVER_PORT)}
            />
          </TextField>
          <Button
            variant="secondary"
            isDisabled={!portValid || discovery.state.status === "scanning"}
            onPress={() => void discovery.start(portNumber)}
          >
            {discovery.state.status === "scanning" ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label>{id.server.discover}</Button.Label>
            )}
          </Button>

          {discovery.state.status === "scanning" ? (
            <Typography type="body-sm" color="muted">
              {`${id.server.discoverProgress} ${discovery.state.done}/${discovery.state.total}`}
            </Typography>
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

          {discovery.state.found.length > 0 ? (
            <ListGroup variant="secondary">
              {discovery.state.found.map((result, index) => (
                <View key={result.origin}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item onPress={() => pick(result)}>
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
                </View>
              ))}
            </ListGroup>
          ) : null}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="gap-4">
          <TextField isInvalid={test.kind === "fail"}>
            <Label>{id.server.manualLabel}</Label>
            <Input
              value={manual}
              onChangeText={(value) => {
                setManual(value);
                if (test.kind !== "idle") setTest({ kind: "idle" });
              }}
              placeholder={id.server.manualPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void runTest(manual)}
            />
            <Description>{id.server.manualHint}</Description>
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

          {test.kind === "ok" ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{id.server.testOk}</Alert.Title>
                <Alert.Description>{originAuthority(test.origin)}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {test.kind === "fail" ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{test.message}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </Card.Body>
      </Card>

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
