/**
 * Packet Annotations Store — marks and colors for individual packets.
 *
 * Annotations are keyed by a compound key: `${sessionId}::${packetIndex}`.
 * Persisted via the centralised session state system (encrypted SQLite).
 */

import { create } from "zustand";

// ── Color Palette ────────────────────────────────────────────────────────

export const PACKET_COLORS = [
  { id: "red",     label: "Red",     bg: "bg-annotation-red/15",     border: "border-l-annotation-red",     dot: "bg-annotation-red" },
  { id: "orange",  label: "Orange",  bg: "bg-annotation-orange/15",  border: "border-l-annotation-orange",  dot: "bg-annotation-orange" },
  { id: "yellow",  label: "Yellow",  bg: "bg-annotation-yellow/12",  border: "border-l-annotation-yellow",  dot: "bg-annotation-yellow" },
  { id: "green",   label: "Green",   bg: "bg-annotation-green/15",   border: "border-l-annotation-green",   dot: "bg-annotation-green" },
  { id: "cyan",    label: "Cyan",    bg: "bg-annotation-cyan/15",    border: "border-l-annotation-cyan",    dot: "bg-annotation-cyan" },
  { id: "blue",    label: "Blue",    bg: "bg-annotation-blue/15",    border: "border-l-annotation-blue",    dot: "bg-annotation-blue" },
  { id: "teal",    label: "Teal",    bg: "bg-annotation-teal/15",    border: "border-l-annotation-teal",    dot: "bg-annotation-teal" },
  { id: "sky",     label: "Sky",     bg: "bg-annotation-sky/15",     border: "border-l-annotation-sky",     dot: "bg-annotation-sky" },
] as const;

export type PacketColorId = (typeof PACKET_COLORS)[number]["id"];

export function getPacketColor(id: PacketColorId) {
  return PACKET_COLORS.find((c) => c.id === id);
}

// ── Types ────────────────────────────────────────────────────────────────

export interface PacketAnnotation {
  marked?: boolean;
  colorId?: PacketColorId;
  note?: string;
}

interface PacketAnnotationState {
  /** Map of "sessionId::packetIndex" → annotation */
  annotations: Record<string, PacketAnnotation>;

  // ── Actions ──
  toggleMark: (sessionId: string, packetIndex: number) => void;
  setMark: (sessionId: string, packetIndex: number, marked: boolean) => void;
  setColor: (sessionId: string, packetIndex: number, colorId: PacketColorId | undefined) => void;
  setNote: (sessionId: string, packetIndex: number, note: string) => void;
  clearAnnotation: (sessionId: string, packetIndex: number) => void;
  clearAllForSession: (sessionId: string) => void;
  clearAllMarks: (sessionId: string) => void;
  clearAllColors: (sessionId: string) => void;

  // ── Selectors ──
  getAnnotation: (sessionId: string, packetIndex: number) => PacketAnnotation | undefined;
  isMarked: (sessionId: string, packetIndex: number) => boolean;
  getColor: (sessionId: string, packetIndex: number) => PacketColorId | undefined;
  getMarkedIndices: (sessionId: string) => number[];
  getColoredIndices: (sessionId: string) => number[];
  getAnnotatedCount: (sessionId: string) => { marked: number; colored: number };
}

function makeKey(sessionId: string, index: number) {
  return `${sessionId}::${index}`;
}

function parseKey(key: string): { sessionId: string; index: number } | null {
  const sep = key.indexOf("::");
  if (sep === -1) return null;
  const sessionId = key.slice(0, sep);
  const index = parseInt(key.slice(sep + 2), 10);
  if (isNaN(index)) return null;
  return { sessionId, index };
}

// ── Store ────────────────────────────────────────────────────────────────

export const usePacketAnnotationStore = create<PacketAnnotationState>()((set, get) => ({
      annotations: {},

      toggleMark: (sessionId, packetIndex) => {
        const key = makeKey(sessionId, packetIndex);
        set((s) => {
          const existing = s.annotations[key];
          const newMarked = !(existing?.marked ?? false);
          const annotation: PacketAnnotation = { ...existing, marked: newMarked };
          // Remove entry if it's now empty
          if (!annotation.marked && !annotation.colorId && !annotation.note) {
            const next = { ...s.annotations };
            delete next[key];
            return { annotations: next };
          }
          return { annotations: { ...s.annotations, [key]: annotation } };
        });
      },

      setMark: (sessionId, packetIndex, marked) => {
        const key = makeKey(sessionId, packetIndex);
        set((s) => {
          const existing = s.annotations[key];
          const annotation: PacketAnnotation = { ...existing, marked };
          if (!annotation.marked && !annotation.colorId && !annotation.note) {
            const next = { ...s.annotations };
            delete next[key];
            return { annotations: next };
          }
          return { annotations: { ...s.annotations, [key]: annotation } };
        });
      },

      setColor: (sessionId, packetIndex, colorId) => {
        const key = makeKey(sessionId, packetIndex);
        set((s) => {
          const existing = s.annotations[key];
          const annotation: PacketAnnotation = { ...existing, colorId };
          if (!annotation.marked && !annotation.colorId && !annotation.note) {
            const next = { ...s.annotations };
            delete next[key];
            return { annotations: next };
          }
          return { annotations: { ...s.annotations, [key]: annotation } };
        });
      },

      setNote: (sessionId, packetIndex, note) => {
        const key = makeKey(sessionId, packetIndex);
        set((s) => {
          const existing = s.annotations[key];
          const annotation: PacketAnnotation = { ...existing, note: note || undefined };
          if (!annotation.marked && !annotation.colorId && !annotation.note) {
            const next = { ...s.annotations };
            delete next[key];
            return { annotations: next };
          }
          return { annotations: { ...s.annotations, [key]: annotation } };
        });
      },

      clearAnnotation: (sessionId, packetIndex) => {
        const key = makeKey(sessionId, packetIndex);
        set((s) => {
          const next = { ...s.annotations };
          delete next[key];
          return { annotations: next };
        });
      },

      clearAllForSession: (sessionId) => {
        set((s) => {
          const next: Record<string, PacketAnnotation> = {};
          for (const [k, v] of Object.entries(s.annotations)) {
            if (!k.startsWith(sessionId + "::")) next[k] = v;
          }
          return { annotations: next };
        });
      },

      clearAllMarks: (sessionId) => {
        set((s) => {
          const next: Record<string, PacketAnnotation> = {};
          for (const [k, v] of Object.entries(s.annotations)) {
            if (k.startsWith(sessionId + "::")) {
              const cleaned = { ...v, marked: undefined };
              if (cleaned.colorId || cleaned.note) next[k] = cleaned;
              // else drop the entry
            } else {
              next[k] = v;
            }
          }
          return { annotations: next };
        });
      },

      clearAllColors: (sessionId) => {
        set((s) => {
          const next: Record<string, PacketAnnotation> = {};
          for (const [k, v] of Object.entries(s.annotations)) {
            if (k.startsWith(sessionId + "::")) {
              const cleaned = { ...v, colorId: undefined };
              if (cleaned.marked || cleaned.note) next[k] = cleaned;
            } else {
              next[k] = v;
            }
          }
          return { annotations: next };
        });
      },

      getAnnotation: (sessionId, packetIndex) => {
        return get().annotations[makeKey(sessionId, packetIndex)];
      },

      isMarked: (sessionId, packetIndex) => {
        return get().annotations[makeKey(sessionId, packetIndex)]?.marked ?? false;
      },

      getColor: (sessionId, packetIndex) => {
        return get().annotations[makeKey(sessionId, packetIndex)]?.colorId;
      },

      getMarkedIndices: (sessionId) => {
        const prefix = sessionId + "::";
        const indices: number[] = [];
        for (const [k, v] of Object.entries(get().annotations)) {
          if (k.startsWith(prefix) && v.marked) {
            const parsed = parseKey(k);
            if (parsed) indices.push(parsed.index);
          }
        }
        return indices.sort((a, b) => a - b);
      },

      getColoredIndices: (sessionId) => {
        const prefix = sessionId + "::";
        const indices: number[] = [];
        for (const [k, v] of Object.entries(get().annotations)) {
          if (k.startsWith(prefix) && v.colorId) {
            const parsed = parseKey(k);
            if (parsed) indices.push(parsed.index);
          }
        }
        return indices.sort((a, b) => a - b);
      },

      getAnnotatedCount: (sessionId) => {
        const prefix = sessionId + "::";
        let marked = 0;
        let colored = 0;
        for (const [k, v] of Object.entries(get().annotations)) {
          if (k.startsWith(prefix)) {
            if (v.marked) marked++;
            if (v.colorId) colored++;
          }
        }
        return { marked, colored };
      },
}));
