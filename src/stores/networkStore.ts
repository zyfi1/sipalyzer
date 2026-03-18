/**
 * Central network state: local IP and interfaces.
 * Refreshed in real time via useNetworkSync (poll + focus + online).
 * Header and packet capture use this for consistent, up-to-date network info.
 */

import { create } from "zustand";
import { listInterfaces } from "@/api/packetCapture";
import type { NetworkInterface } from "@/types/packetCapture";
import { pickBestLocalIp } from "@/lib/networkUtils";

interface NetworkState {
  localIp: string | null;
  interfaces: NetworkInterface[];
  loading: boolean;
  lastFetched: number | null;
  refresh: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  localIp: null,
  interfaces: [],
  loading: false,
  lastFetched: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const interfaces = await listInterfaces();
      const localIp = pickBestLocalIp(interfaces);
      set({
        interfaces,
        localIp,
        loading: false,
        lastFetched: Date.now(),
      });
    } catch (error) {
      console.error("Network refresh failed:", error);
      set({ loading: false });
    }
  },
}));
