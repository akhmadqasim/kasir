import { canEditProduct, id } from "@kasir/shared";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import { Alert, Button, Input, Label, Spinner, TextField, Typography } from "heroui-native";
import { useCallback, useRef, useState, type JSX } from "react";
import { View } from "react-native";

import { ScrollScreen } from "@/components/screen";
import { InlineError } from "@/components/state-view";
import { useProductLookup } from "@/hooks/use-product-lookup";
import { useCurrentUser } from "@/hooks/use-session";

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

  const [manual, setManual] = useState("");
  const [focused, setFocused] = useState(false);
  const lastScan = useRef<{ code: string; at: number } | null>(null);

  // Only run the camera while this tab is on screen.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      lookup.reset();
      return () => setFocused(false);
      // `lookup` is a fresh object each render; `reset` itself is stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const notFound = lookup.data && lookup.data.product === null ? lookup.data.code : null;

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    const previous = lastScan.current;
    if (lookup.isPending || notFound) return;
    if (previous && previous.code === data && now - previous.at < RESCAN_COOLDOWN_MS) return;
    lastScan.current = { code: data, at: now };
    lookup.mutate(data);
  };

  const submitManual = () => {
    const code = manual.trim();
    if (!code || lookup.isPending) return;
    lookup.mutate(code);
  };

  const scanAgain = () => {
    lookup.reset();
    lastScan.current = null;
  };

  return (
    <ScrollScreen>
      {permission?.granted ? (
        <View className="aspect-[3/4] w-full overflow-hidden rounded-3xl bg-surface-secondary">
          {focused ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={notFound || lookup.isPending ? undefined : onScanned}
            />
          ) : null}
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

      {permission?.granted && !notFound ? (
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
