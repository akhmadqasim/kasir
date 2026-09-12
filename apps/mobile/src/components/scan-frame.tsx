import { useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

/** How long one sweep of the line takes, top to bottom. */
const SWEEP_MS = 2200;

/** Drawn as a fraction of the viewfinder's height, so it scales with the box. */
const TRAVEL = 0.86;

interface ScanFrameProps {
  /** Height of the viewfinder in points — the line needs a distance to travel. */
  height: number;
  active: boolean;
}

/**
 * The moving line inside the viewfinder.
 *
 * A camera preview with nothing moving on it looks frozen, and a stock-taker
 * who thinks the scanner has hung starts typing codes by hand. The sweep says
 * "still looking" without claiming anything about what it has found — the
 * barcode reader is running the whole time either way.
 *
 * Built on React Native's own `Animated` with `useNativeDriver`, so it costs no
 * new dependency and no JS frame. It stops dead when the camera is off: an
 * animation loop over an unmounted preview is a battery leak with nothing to
 * show for it.
 *
 * Reduce Motion replaces the sweep with a still line at the centre. Someone who
 * turned that switch on did so because moving things make them ill; a viewfinder
 * is not the place to argue.
 */
export function ScanFrame({ height, active }: ScanFrameProps): JSX.Element {
  const accent = useThemeColor("accent");
  // A lazy `useState` rather than a ref: the driver is read during render to
  // build the interpolation, and it must survive re-renders without being
  // rebuilt on each one.
  const [progress] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      progress.stopAnimation();
      progress.setValue(0.5);
      return;
    }

    progress.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: SWEEP_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: SWEEP_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, progress]);

  const travel = height * TRAVEL;
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * ((1 - TRAVEL) / 2), height * ((1 - TRAVEL) / 2) + travel],
  });

  return (
    <View pointerEvents="none" className="absolute inset-0 justify-start" accessible={false}>
      <Animated.View
        style={{ transform: [{ translateY }], backgroundColor: accent, height: 2 }}
        className="mx-6 rounded-full opacity-90"
      />
    </View>
  );
}
