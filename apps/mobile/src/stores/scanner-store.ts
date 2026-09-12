import { create } from "zustand";

/**
 * Whether the user wants the scanner camera running.
 *
 * Deliberately **not** persisted: a stock-taker who switched the camera off to
 * type a few codes expects it back the next time they open the app, and a
 * preference that outlives the session would quietly turn the main screen of a
 * scanning tool into a text box. It survives tab switches and backgrounding,
 * which is all it is for.
 *
 * The camera is also paused when the tab is not focused or the app is in the
 * background — that is `(tabs)/scan.tsx`'s job, not a preference, and it does
 * not touch this flag.
 */
export interface ScannerState {
  cameraEnabled: boolean;
  setCameraEnabled: (enabled: boolean) => void;
  toggleCamera: () => void;
}

export const useScannerStore = create<ScannerState>()((set) => ({
  cameraEnabled: true,
  setCameraEnabled: (cameraEnabled) => set({ cameraEnabled }),
  toggleCamera: () => set((state) => ({ cameraEnabled: !state.cameraEnabled })),
}));
