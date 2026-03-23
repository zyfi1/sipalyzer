/**
 * Shared column system for packet list views.
 *
 * Both PacketListView (saved captures) and WarperPacketList (live monitor)
 * import types, defaults, and helpers from here so the column definition
 * stays in one place.
 */

// ── Column types ────────────────────────────────────────────────────

export type ColumnId =
  | "time"
  | "source"
  | "destination"
  | "protocol"
  | "length"
  | "info"
  | "srcMac"
  | "dstMac"
  | "ttl"
  | "tcpFlags"
  | "tcpSeq"
  | "tcpAck"
  | "udpLength"
  | "frameNumber"
  | "checksum";

export type SortColumn = ColumnId | null;
export type SortDirection = "asc" | "desc" | null;

export interface ColumnConfig {
  id: ColumnId;
  label: string;
  width: number;
  visible: boolean;
  sortable: boolean;
  align?: "left" | "right" | "center";
}

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_COLUMN_CONFIGS: Record<ColumnId, ColumnConfig> = {
  time:        { id: "time",        label: "Time",      width: 140, visible: true,  sortable: true,  align: "left"  },
  source:      { id: "source",      label: "Source",     width: 150, visible: true,  sortable: true,  align: "left"  },
  destination: { id: "destination", label: "Destination",width: 150, visible: true,  sortable: true,  align: "left"  },
  protocol:    { id: "protocol",    label: "Protocol",   width: 90,  visible: true,  sortable: true,  align: "left"  },
  length:      { id: "length",      label: "Length",     width: 80,  visible: true,  sortable: true,  align: "right" },
  info:        { id: "info",        label: "Info",       width: 200, visible: true,  sortable: false, align: "left"  },
  srcMac:      { id: "srcMac",      label: "Src MAC",    width: 140, visible: false, sortable: true,  align: "left"  },
  dstMac:      { id: "dstMac",      label: "Dst MAC",    width: 140, visible: false, sortable: true,  align: "left"  },
  ttl:         { id: "ttl",         label: "TTL",        width: 60,  visible: false, sortable: true,  align: "right" },
  tcpFlags:    { id: "tcpFlags",    label: "TCP Flags",  width: 100, visible: false, sortable: false, align: "left"  },
  tcpSeq:      { id: "tcpSeq",      label: "TCP Seq",    width: 100, visible: false, sortable: true,  align: "right" },
  tcpAck:      { id: "tcpAck",      label: "TCP Ack",    width: 100, visible: false, sortable: true,  align: "right" },
  udpLength:   { id: "udpLength",   label: "UDP Len",    width: 80,  visible: false, sortable: true,  align: "right" },
  frameNumber: { id: "frameNumber", label: "#",          width: 80,  visible: true,  sortable: true,  align: "right" },
  checksum:    { id: "checksum",    label: "Checksum",   width: 100, visible: false, sortable: false, align: "left"  },
};

/** Logical column order used when no saved order exists. */
export const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  "time", "source", "destination", "protocol", "length",
  "srcMac", "dstMac", "ttl", "tcpFlags", "tcpSeq", "tcpAck",
  "udpLength", "checksum", "info",
];

/** Columns visible by default. */
export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
  "time", "source", "destination", "protocol", "length", "info", "frameNumber",
];

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a CSS `grid-template-columns` string from visible columns. */
export function getGridTemplateColumns(
  visibleColumns: ColumnConfig[],
  configs: Record<ColumnId, ColumnConfig>,
): string {
  const lastVisibleId = visibleColumns[visibleColumns.length - 1]?.id ?? null;
  return visibleColumns
    .map((col) => {
      if (col.id === "info" && lastVisibleId === "info") {
        // Keep Info stretchy only when it's the trailing column.
        return `minmax(${configs.info.width}px, 1fr)`;
      }
      return `${configs[col.id].width}px`;
    })
    .join(" ");
}

/** Compute the ordered array of visible columns. */
export function getVisibleColumns(
  configs: Record<ColumnId, ColumnConfig>,
  columnOrder: ColumnId[],
): ColumnConfig[] {
  const visible = Object.values(configs).filter(col => col.visible);
  const frameNumberCol = visible.find(col => col.id === "frameNumber");
  const otherVisible = visible.filter(col => col.id !== "frameNumber");

  if (columnOrder.length > 0) {
    const orderedIds = columnOrder.filter(id => id !== "frameNumber");
    const ordered = orderedIds
      .map(id => otherVisible.find(col => col.id === id))
      .filter(Boolean) as ColumnConfig[];
    const orderedIdsSet = new Set(ordered.map(col => col.id));
    const newColumns = otherVisible.filter(col => !orderedIdsSet.has(col.id));
    return frameNumberCol
      ? [frameNumberCol, ...ordered, ...newColumns]
      : [...ordered, ...newColumns];
  }

  const sortedOthers = [...otherVisible].sort((a, b) => {
    const aIdx = DEFAULT_COLUMN_ORDER.indexOf(a.id);
    const bIdx = DEFAULT_COLUMN_ORDER.indexOf(b.id);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return frameNumberCol ? [frameNumberCol, ...sortedOthers] : sortedOthers;
}

import { useUiPrefsStore } from "@/stores/uiPrefsStore";

/** Load column configs from uiPrefsStore, merging with defaults. */
export function loadColumnConfigs(): Record<ColumnId, ColumnConfig> {
  const saved = useUiPrefsStore.getState().packetColumnConfigs;
  let merged = { ...DEFAULT_COLUMN_CONFIGS };

  if (saved) {
    try {
      Object.keys(saved).forEach((key) => {
        if (key in merged) {
          merged[key as ColumnId] = { ...merged[key as ColumnId], ...(saved as Record<string, unknown>)[key] as Partial<ColumnConfig> };
        }
      });
    } catch {
      merged = { ...DEFAULT_COLUMN_CONFIGS };
    }
  }

  // Always enforce frameNumber label
  merged.frameNumber.label = "#";

  // Auto-fix: if only frameNumber is visible, restore defaults
  const visibleCount = Object.values(merged).filter(col => col.visible).length;
  if (visibleCount === 1 && merged.frameNumber.visible) {
    DEFAULT_VISIBLE_COLUMNS.forEach(colId => {
      if (colId in merged && colId !== "frameNumber") {
        merged[colId] = { ...merged[colId], visible: true };
      }
    });
  }

  return merged;
}

/** Save column configs to uiPrefsStore. */
export function saveColumnConfigs(configs: Record<ColumnId, ColumnConfig>): void {
  useUiPrefsStore.getState().setPacketColumnConfigs(configs as unknown as Record<string, unknown>);
}

/** Load column order from uiPrefsStore. */
export function loadColumnOrder(): ColumnId[] {
  return (useUiPrefsStore.getState().packetColumnOrder ?? []) as ColumnId[];
}

/** Save column order to uiPrefsStore (including [] so visibility toggles persist). */
export function saveColumnOrder(order: ColumnId[]): void {
  useUiPrefsStore.getState().setPacketColumnOrder(order as string[]);
}

/** Fresh copy of default column configs (visibility + widths). */
export function cloneDefaultColumnConfigs(): Record<ColumnId, ColumnConfig> {
  return (Object.keys(DEFAULT_COLUMN_CONFIGS) as ColumnId[]).reduce((acc, id) => {
    acc[id] = { ...DEFAULT_COLUMN_CONFIGS[id] };
    return acc;
  }, {} as Record<ColumnId, ColumnConfig>);
}

/** Default column order persisted in prefs: `#` first, then logical order (no duplicate frameNumber). */
export function getDefaultPacketColumnOrder(): ColumnId[] {
  return ["frameNumber", ...DEFAULT_COLUMN_ORDER];
}

/** Reset saved prefs and return state to apply in React (configs + order). */
export function resetPacketColumnsToDefaults(): {
  configs: Record<ColumnId, ColumnConfig>;
  order: ColumnId[];
} {
  const configs = cloneDefaultColumnConfigs();
  const order = getDefaultPacketColumnOrder();
  saveColumnConfigs(configs);
  saveColumnOrder(order);
  return { configs, order };
}

/**
 * Reorder only visible columns while preserving hidden-column order.
 * Frame number is expected to stay pinned by callers.
 */
export function reorderVisibleColumns(
  currentOrder: ColumnId[],
  visibleColumnIds: ColumnId[],
  draggedId: ColumnId,
  targetId: ColumnId,
): ColumnId[] {
  if (draggedId === targetId) return currentOrder;

  const visibleSet = new Set(visibleColumnIds);
  const baseOrder: ColumnId[] = [...currentOrder];
  for (const id of visibleColumnIds) {
    if (!baseOrder.includes(id)) baseOrder.push(id);
  }
  if (!baseOrder.includes(draggedId)) baseOrder.push(draggedId);
  if (!baseOrder.includes(targetId)) baseOrder.push(targetId);

  const orderedVisible = baseOrder.filter((id) => visibleSet.has(id));
  const from = orderedVisible.indexOf(draggedId);
  const to = orderedVisible.indexOf(targetId);
  if (from === -1 || to === -1) return baseOrder;

  const [moved] = orderedVisible.splice(from, 1);
  if (!moved) return baseOrder;
  orderedVisible.splice(to, 0, moved);

  let visibleIdx = 0;
  return baseOrder.map((id) => {
    if (!visibleSet.has(id)) return id;
    const nextId = orderedVisible[visibleIdx];
    visibleIdx += 1;
    return nextId ?? id;
  });
}
