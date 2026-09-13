import { canEditProduct, id } from "@kasir/shared";
import { useCameraPermissions } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import { Alert, Button, SearchField } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { View } from "react-native";

import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import { PageHeader } from "@/components/page-header";
import { PlatformIcon } from "@/components/platform-icon";
import { ProductList } from "@/components/product-list";
import { Screen } from "@/components/screen";
import { InlineError } from "@/components/state-view";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOpenProduct } from "@/hooks/use-open-product";
import { useProductLookup } from "@/hooks/use-product-lookup";
import { useProductSearch } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";

/**
 * Find one item, by whatever the stock-taker has to hand.
 *
 * A field and a list — the same rows and the same navigation as Produk — with
 * the camera behind a barcode button rather than running underneath the whole
 * screen. Typing searches as you go; the camera opens only when asked and
 * closes as soon as it has read something, which is also when the permission
 * prompt appears for the first time.
 */
export default function ScanTab(): JSX.Element {
  const router = useRouter();
  const user = useCurrentUser();
  const openProduct = useOpenProduct();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useProductLookup();

  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);

  const query = useDebouncedValue(search.trim(), 300);
  const result = useProductSearch({ query });

  // Coming back to the tab should not land on the last scan's error.
  useFocusEffect(
    useCallback(() => {
      setNotFound(null);
      lookup.reset();
      // `lookup` is a fresh object each render; `reset` itself is stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const openScanner = async () => {
    setNotFound(null);
    lookup.reset();
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setScanning(true);
  };

  const onScanned = (code: string) => {
    lookup.mutate(code, {
      onSuccess: ({ product }) => {
        setScanning(false);
        if (product) {
          hapticSuccess();
          openProduct(product);
          return;
        }
        hapticWarning();
        setNotFound(code);
      },
      onError: () => {
        setScanning(false);
        hapticWarning();
      },
    });
  };

  return (
    <Screen>
      <ProductList
        result={result}
        emptyMessage={query ? id.products.noResults : id.scan.searchPrompt}
        header={
          <>
            <PageHeader title={id.scan.title} />

            <View className="flex-row items-center gap-3">
              <SearchField
                className="flex-1"
                value={search}
                onChange={setSearch}
                accessibilityLabel={id.scan.searchLabel}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder={id.scan.searchPlaceholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              <Button
                variant="secondary"
                isIconOnly
                accessibilityLabel={id.scan.openCamera}
                onPress={() => void openScanner()}
              >
                <PlatformIcon sf="barcode.viewfinder" md="barcode-scan" size={22} />
              </Button>
            </View>

            {permission?.granted === false && permission.canAskAgain === false ? (
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{id.scan.permissionTitle}</Alert.Title>
                  <Alert.Description>{id.scan.permissionBody}</Alert.Description>
                </Alert.Content>
              </Alert>
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
                  <Button variant="secondary" className="flex-1" onPress={() => void openScanner()}>
                    {id.scan.scanAgain}
                  </Button>
                  {canEditProduct(user.role) ? (
                    <Button
                      className="flex-1"
                      onPress={() => {
                        const barcode = notFound;
                        setNotFound(null);
                        router.push({ pathname: "/products/new", params: { barcode } });
                      }}
                    >
                      {id.scan.addProduct}
                    </Button>
                  ) : null}
                </View>
              </View>
            ) : null}

            <InlineError error={lookup.error} />
          </>
        }
      />

      <BarcodeScannerModal
        visible={scanning}
        isBusy={lookup.isPending}
        onScanned={onScanned}
        onClose={() => setScanning(false)}
      />
    </Screen>
  );
}
