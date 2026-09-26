import { id } from "@kasir/shared";
import { useState, type JSX } from "react";
import { Image, View } from "react-native";
import { SvgUri } from "react-native-svg";

const SIZE = 64;

type Stage = "raster" | "svg" | "hidden";

interface StoreLogoProps {
  uri: string;
}

/**
 * The store logo above the login form.
 *
 * The server takes PNG, JPEG, WebP or SVG, and the public store slice only says
 * *that* there is a logo, not which kind. React Native's `Image` draws the first
 * three but not SVG, so the raster attempt goes first and its failure falls
 * through to `SvgUri`. A logo neither can draw is left out instead of leaving an
 * empty box above the shop's name, which still says whose till this is.
 *
 * Give it `key={uri}` so a replaced logo starts over from the raster attempt.
 */
export function StoreLogo({ uri }: StoreLogoProps): JSX.Element | null {
  const [stage, setStage] = useState<Stage>("raster");

  if (stage === "hidden") return null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={id.auth.storeLogo}
      style={{ width: SIZE, height: SIZE }}
    >
      {stage === "raster" ? (
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={{ width: SIZE, height: SIZE }}
          onError={() => setStage("svg")}
        />
      ) : (
        <SvgUri uri={uri} width={SIZE} height={SIZE} onError={() => setStage("hidden")} />
      )}
    </View>
  );
}
