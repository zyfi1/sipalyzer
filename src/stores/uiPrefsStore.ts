/**
 * UI Preferences store — miscellaneous preferences previously scattered across
 * localStorage in individual components. Now centralised here so the session
 * state system can persist them alongside everything else.
 */

import { create } from "zustand";

export interface UiPrefsState {
  /** Packet list column visibility / width configs (JSON-serialised). */
  packetColumnConfigs: Record<string, unknown> | null;
  /** Packet list column order. */
  packetColumnOrder: string[] | null;
  /** Recent wireshark-style filter strings. */
  wiresharkFilterHistory: string[];
  /** Recent command-palette item IDs. */
  cmdPaletteRecent: string[];
  /** Available note categories (not yet used in an actual note). */
  noteCategories: string[];
  /** Available note tags (not yet used in an actual note). */
  noteTags: string[];

  // ── Actions ──
  setPacketColumnConfigs: (configs: Record<string, unknown>) => void;
  setPacketColumnOrder: (order: string[]) => void;
  addWiresharkFilterHistory: (filter: string) => void;
  removeWiresharkFilterHistory: (filter: string) => void;
  clearWiresharkFilterHistory: () => void;
  setWiresharkFilterHistory: (history: string[]) => void;
  addCmdPaletteRecent: (id: string) => void;
  setCmdPaletteRecent: (ids: string[]) => void;
  setNoteCategories: (cats: string[]) => void;
  setNoteTags: (tags: string[]) => void;
}

const MAX_FILTER_HISTORY = 20;
const MAX_PALETTE_RECENT = 30;

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  packetColumnConfigs: null,
  packetColumnOrder: null,
  wiresharkFilterHistory: [],
  cmdPaletteRecent: [],
  noteCategories: [],
  noteTags: [],

  setPacketColumnConfigs: (configs) => set({ packetColumnConfigs: configs }),
  setPacketColumnOrder: (order) => set({ packetColumnOrder: order }),

  addWiresharkFilterHistory: (filter) => {
    const trimmed = filter.trim();
    if (!trimmed) return;
    const prev = get().wiresharkFilterHistory.filter((f) => f !== trimmed);
    set({ wiresharkFilterHistory: [trimmed, ...prev].slice(0, MAX_FILTER_HISTORY) });
  },
  removeWiresharkFilterHistory: (filter) => {
    const trimmed = filter.trim();
    if (!trimmed) return;
    set((s) => ({
      wiresharkFilterHistory: s.wiresharkFilterHistory.filter((f) => f !== trimmed),
    }));
  },
  clearWiresharkFilterHistory: () => set({ wiresharkFilterHistory: [] }),
  setWiresharkFilterHistory: (history) => set({ wiresharkFilterHistory: history }),

  addCmdPaletteRecent: (id) => {
    const prev = get().cmdPaletteRecent.filter((x) => x !== id);
    set({ cmdPaletteRecent: [id, ...prev].slice(0, MAX_PALETTE_RECENT) });
  },
  setCmdPaletteRecent: (ids) => set({ cmdPaletteRecent: ids }),

  setNoteCategories: (cats) => set({ noteCategories: cats }),
  setNoteTags: (tags) => set({ noteTags: tags }),
}));
