import { create } from "zustand";
import { checkForUpdate, installUpdate, type UpdaterReleaseInfo } from "@/api/updater";
import type { ReleaseChannel } from "@/lib/updater/channels";

interface UpdaterState {
  checking: boolean;
  installing: boolean;
  lastCheckedAt: string | null;
  availableUpdate: UpdaterReleaseInfo | null;
  lastError: string | null;
  checkForUpdates: (channel: ReleaseChannel) => Promise<UpdaterReleaseInfo | null>;
  installAvailableUpdate: (channel: ReleaseChannel) => Promise<UpdaterReleaseInfo | null>;
  clearAvailableUpdate: () => void;
  clearError: () => void;
}

export const useUpdaterStore = create<UpdaterState>()((set) => ({
  checking: false,
  installing: false,
  lastCheckedAt: null,
  availableUpdate: null,
  lastError: null,

  checkForUpdates: async (channel) => {
    set({ checking: true, lastError: null });
    try {
      const update = await checkForUpdate(channel);
      set({
        checking: false,
        availableUpdate: update,
        lastCheckedAt: new Date().toISOString(),
      });
      return update;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        checking: false,
        // Never show a stale badge from a previous successful check.
        availableUpdate: null,
        lastError: message,
        lastCheckedAt: new Date().toISOString(),
      });
      return null;
    }
  },

  installAvailableUpdate: async (channel) => {
    set({ installing: true, lastError: null });
    try {
      const installed = await installUpdate(channel);
      set({
        installing: false,
        // Clear stale badge after successful install flow.
        availableUpdate: null,
      });
      return installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Avoid showing stale availability after install failure.
      set({ installing: false, availableUpdate: null, lastError: message });
      return null;
    }
  },

  clearAvailableUpdate: () => set({ availableUpdate: null }),
  clearError: () => set({ lastError: null }),
}));
