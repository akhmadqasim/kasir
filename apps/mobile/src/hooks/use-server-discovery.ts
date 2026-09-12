import {
  DEFAULT_SERVER_PORT,
  discoverServers,
  probeServer,
  subnetHosts,
  type ProbeResult,
} from "@kasir/shared";
import * as Network from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";

export type DiscoveryStatus = "idle" | "scanning" | "done" | "no_network";

export interface DiscoveryState {
  status: DiscoveryStatus;
  /** Hosts probed so far, out of `total`. */
  done: number;
  total: number;
  found: ProbeResult[];
  ownIp: string | null;
}

const IDLE: DiscoveryState = { status: "idle", done: 0, total: 0, found: [], ownIp: null };

/**
 * Scan the phone's /24 for a kasir server on `port`.
 *
 * `expo-network` gives the IPv4 address but not the mask, so the range is
 * assumed to be a /24 (`packages/shared/src/net/lan.ts`). Results arrive as
 * they are found; the scan is cancelled on unmount or when `start` is called
 * again with another port.
 */
export function useServerDiscovery() {
  const [state, setState] = useState<DiscoveryState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  /**
   * Stop the sweep. The status drops back to `idle` so a screen that offers a
   * cancel button does not sit on a progress bar that has stopped moving;
   * whatever was already found stays listed, because those servers are real.
   */
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState((prev) => (prev.status === "scanning" ? { ...prev, status: "idle" } : prev));
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    async (port: number = DEFAULT_SERVER_PORT) => {
      cancel();
      const own = new AbortController();
      controller.current = own;

      const network = await Network.getNetworkStateAsync();
      const ownIp = await Network.getIpAddressAsync();
      const hosts = subnetHosts(ownIp);

      // Asking the OS for the Wi-Fi state takes long enough to tap "Batal" in.
      // Without this the scan would still announce itself as running, then
      // finish silently against an already-aborted signal and leave the
      // progress bar stuck at 0.
      if (own.signal.aborted) return;

      if (!network.isConnected || hosts.length === 0) {
        setState({ ...IDLE, status: "no_network", ownIp });
        return;
      }

      setState({ status: "scanning", done: 0, total: hosts.length, found: [], ownIp });

      await discoverServers(ownIp, {
        port,
        concurrency: 32,
        timeoutMs: 600,
        signal: own.signal,
        onProgress: (done, total) => {
          if (!own.signal.aborted) setState((prev) => ({ ...prev, done, total }));
        },
        onFound: (result) => {
          if (!own.signal.aborted) {
            setState((prev) => ({ ...prev, found: [...prev.found, result] }));
          }
        },
      });

      if (!own.signal.aborted) setState((prev) => ({ ...prev, status: "done" }));
    },
    [cancel]
  );

  return { state, start, cancel };
}

/** One-off check of a single origin, for "Uji koneksi". */
export function testServer(origin: string): Promise<ProbeResult> {
  return probeServer(origin, { timeoutMs: 3000 });
}
