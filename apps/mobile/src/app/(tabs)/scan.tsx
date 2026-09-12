import { canEditProduct, id } from "@kasir/shared";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import {
  Alert,
  Button,
  GlassView,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
} from "heroui-native";
import { useCallback, useRef, useState, type JSX } from "react";
import { View } from "react-native";

import { PageHeader } from "@/components/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { ScrollScreen } from "@/components/screen";
import { InlineError } from "@/components/state-view";
import { useAppActive } from "@/hooks/use-app-active";
import { useProductLookup } from "@/hooks/use-product-lookup";
import { useCurrentUser } from "@/hooks/use-session";
import { hapticSelection, hapticSuccess, hapticWarning } from "@/lib/haptics";
import { hasLiquidGlass, isIOS } from "@/lib/platform";
import { useScannerStore } from "@/stores/scanner-store";

/**
 * Retail barcodes only. EAN-13 is the Indonesian standard; EAN-8 for small
 * packs; Code 128 for the internal labels the desktop prints; UPC-A because
 * iOS reports an EAN-13 that starts with 0 as UPC-A.
 */
const BARCODE_TYPES = ["ean13", "ean8", "code128", "upc_a"] as const;

/** Ignore the same code re-read within this window: a steady hand scans 10×/s. */
const RESCAN_COOLDOWN_MS = 1500;

export default function ScanTab(): JSX.Element {
  const router = useRouter();
  const user = useCurrentUser();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useProductLookup();

  const cameraEnabled = useScannerStore((state) => state.cameraEnabled);
  const toggleCamera = useScannerStore((state) => state.toggleCamera);
  const isFocused = useIsFocused();
  const appActive = useAppActive();

  const [manual, setManual] = useState("");
  const lastScan = useRef<{ code: string; at: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      lookup.reset();
      // `lookup` is a fresh object each render; `reset` itself is stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const notFound = lookup.data && lookup.data.product === null ? lookup.data.code : null;

  /**
   * The preview is mounted only while it is both wanted and useful: the user has
   * not switched it off, the tab is on screen, and the app is in the foreground.
   * Unmounting rather than hiding is what actually releases the camera.
   */
  const cameraLive = cameraEnabled && isFocused && appActive && permission?.granted === true;

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    const previous = lastScan.current;
    if (lookup.isPending || notFound) return;
    if (previous && previous.code === data && now - previous.at < RESCAN_COOLDOWN_MS) return;
    lastScan.current = { code: data, at: now };
    lookupCode(data);
  };

  const lookupCode = (code: string) => {
    lookup.mutate(code, {
      onSuccess: ({ product }) => (product ? hapticSuccess() : hapticWarning()),
      onError: () => hapticWarning(),
    });
  };

  const submitManual = () => {
    const code = manual.trim();
    if (!code || lookup.isPending) return;
    lookupCode(code);
  };

  const scanAgain = () => {
    lookup.reset();
    lastScan.current = null;
  };

  const onToggleCamera = () => {
    hapticSelection();
    toggleCamera();
  };

  return (
    <ScrollScreen headerless>
      <PageHeader title={id.scan.title} />

      {permission?.granted ? (
        <View className="aspect-[3/4] w-full overflow-hidden rounded-3xl bg-surface-secondary">
          {cameraLive ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={notFound || lookup.isPending ? undefined : onScanned}
            />
          ) : (
            <View className="flex-1 items-center justify-center gap-3 px-6">
              {/* SF Symbols 7 has no `camera.slash`; the hollow `camera` reads as
                  "off" next to the filled one on the toggle. */}
              <PlatformIcon sf="camera" md="camera-off-outline" size={32} />
              {/* Switched off on purpose — the other reasons (tab in the
                  background, app in the background) are never on screen long
                  enough to read, and resolve themselves. */}
              {cameraEnabled ? null : (
                <>
                  <Typography weight="medium">{id.scan.cameraPaused}</Typography>
                  <Typography type="body-sm" color="muted" align="center">
                    {id.scan.cameraPausedBody}
                  </Typography>
                  <Button variant="secondary" onPress={onToggleCamera}>
                    <Button.Label>{id.scan.cameraOn}</Button.Label>
                  </Button>
                </>
              )}
            </View>
          )}

          {cameraLive ? <CameraToggle onPress={onToggleCamera} /> : null}

          {lookup.isPending ? (
            <View className="absolute inset-0 items-center justify-center">
              <Spinner />
            </View>
          ) : null}
        </View>
      ) : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{id.scan.permissionTitle}</Alert.Title>
            <Alert.Description>{id.scan.permissionBody}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!permission?.granted && permission?.canAskAgain !== false ? (
        <Button variant="secondary" onPress={() => void requestPermission()}>
          {id.scan.permissionButton}
        </Button>
      ) : null}

      {cameraLive && !notFound ? (
        <Typography type="body-sm" color="muted" align="center">
          {id.scan.hint}
        </Typography>
      ) : null}

      {notFound ? (
        <View className="gap-3">
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{id.scan.notFound}</Alert.Title>
              <Alert.Description>{`${id.scan.notFoundBody} (${notFound})`}</Alert.Description>
            </Alert.Content>
          </Alert>
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={scanAgain}>
              {id.scan.scanAgain}
            </Button>
            {canEditProduct(user.role) ? (
              <Button
                className="flex-1"
                onPress={() => {
                  scanAgain();
                  router.push({ pathname: "/products/new", params: { barcode: notFound } });
                }}
              >
                {id.scan.addProduct}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}

      <InlineError error={lookup.error} />

      <TextField>
        <Label>{id.scan.manualLabel}</Label>
        <View className="flex-row gap-3">
          <Input
            containerClassName="flex-1"
            className="flex-1"
            value={manual}
            onChangeText={setManual}
            placeholder={id.scan.manualPlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={submitManual}
          />
          <Button
            variant="secondary"
            isDisabled={manual.trim().length === 0 || lookup.isPending}
            onPress={submitManual}
          >
            {id.scan.lookup}
          </Button>
        </View>
      </TextField>
    </ScrollScreen>
  );
}

/**
 * Switch the preview off without leaving the tab.
 *
 * iOS 26 floats controls over content on glass, so the button is a glass circle;
 * Android uses a tonal icon button, which is Material 3's answer for the same
 * "secondary action on top of media" job.
 */
function CameraToggle({ onPress }: { onPress: () => void }): JSX.Element {
  const button = (
    <Button
      variant={isIOS ? "ghost" : "secondary"}
      size="sm"
      isIconOnly
      className="rounded-full"
      accessibilityLabel={id.scan.cameraOff}
      onPress={onPress}
    >
      <PlatformIcon sf="camera.fill" md="camera" size={20} />
    </Button>
  );

  return (
    <View className="absolute right-3 top-3">
      {isIOS ? (
        <GlassView
          className="overflow-hidden rounded-full"
          forceFallbackColor={!hasLiquidGlass}
          fallbackColor="overlay"
        >
          {button}
        </GlassView>
      ) : (
        button
      )}
    </View>
  );
}
