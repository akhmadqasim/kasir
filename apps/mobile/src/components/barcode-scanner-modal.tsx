import { id } from "@kasir/shared";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { Button, Spinner, Typography } from "heroui-native";
import { useState, type JSX } from "react";
import { Modal, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlatformIcon } from "@/components/platform-icon";
import { ScanFrame } from "@/components/scan-frame";
import { useAppActive } from "@/hooks/use-app-active";

/**
 * Retail barcodes only. EAN-13 is the Indonesian standard; EAN-8 for small
 * packs; Code 128 for the internal labels the desktop prints; UPC-A because
 * iOS reports an EAN-13 that starts with 0 as UPC-A.
 */
const BARCODE_TYPES = ["ean13", "ean8", "code128", "upc_a"] as const;

interface BarcodeScannerModalProps {
  visible: boolean;
  /** True while the code that was just read is being looked up. */
  isBusy: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
}

/**
 * The camera, for exactly as long as someone is pointing it at something.
 *
 * It used to sit on the Scan tab permanently, which meant a lens running all
 * day at the till. Now it is a full-screen presentation that opens on request
 * and takes the camera down with it when dismissed — the preview is unmounted,
 * not hidden, which is what actually releases the hardware. A full screen is
 * also what both platforms use for a viewfinder: nothing here would fit in a
 * half sheet.
 *
 * One code per opening. The lookup happens while the sheet is still up so the
 * spinner has somewhere to live; the caller closes it once it knows the answer.
 */
export function BarcodeScannerModal({
  visible,
  isBusy,
  onScanned,
  onClose,
}: BarcodeScannerModalProps): JSX.Element {
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();
  const [height, setHeight] = useState(0);
  const [handled, setHandled] = useState(false);

  const live = visible && appActive && !isBusy && !handled;

  const handleScan = ({ data }: BarcodeScanningResult) => {
    if (handled) return;
    setHandled(true);
    onScanned(data);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onShow={() => setHandled(false)}
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)}
      >
        {live ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={handleScan}
          />
        ) : (
          <View className="flex-1" />
        )}

        <ScanFrame height={height} active={live} />

        {isBusy ? (
          <View className="absolute inset-0 items-center justify-center bg-backdrop/50">
            <Spinner />
          </View>
        ) : null}

        {/* Leading side, which is where both guidelines put the way out of a
            full-screen presentation: HIG's Cancel on a full-screen cover, and
            Material 3's close icon at the start of a full-screen dialog's bar. */}
        <View
          className="absolute inset-x-0 top-0 flex-row justify-start px-4"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Button
            variant="secondary"
            size="sm"
            isIconOnly
            className="rounded-full"
            accessibilityLabel={id.scan.closeCamera}
            onPress={onClose}
          >
            <PlatformIcon sf="xmark" md="close" size={18} />
          </Button>
        </View>

        {/* A pill rather than bare text: the preview behind it is whatever the
            shelf happens to be, so the label needs its own surface to stay
            legible. */}
        <View
          className="absolute inset-x-0 bottom-0 items-center px-6"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          <Typography
            type="body-sm"
            align="center"
            className="overflow-hidden rounded-full bg-overlay px-4 py-2"
          >
            {id.scan.hint}
          </Typography>
        </View>
      </View>
    </Modal>
  );
}
