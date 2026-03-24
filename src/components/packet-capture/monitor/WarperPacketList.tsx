/**
 * High-performance virtualized packet list.
 * Manual virtualizer for fixed-height rows — O(1) range computation.
 * Handles millions of rows at 120 FPS.
 *
 * Now supports the full 15-column system with visibility, resize,
 * reorder, sort, and uiPrefsStore persistence — matching PacketListView.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  memo,
} from "react";
import { cn } from "@/lib/utils";
import { formatIpPortEndpoint } from "@/lib/networkUtils";
import { PanelResizeHandle } from "@/components/ui/panel-chrome";
import { IpAddress } from "@/components/ui/IpAddress";
import { ArrowUp, ArrowDown, Palette, X, Bookmark, Settings2, Link2, ArrowRightLeft, Phone, Scan, ChevronUp, ChevronDown, GripVertical, RotateCcw } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { ScrollFloatingButtons } from "./ScrollFloatingButtons";
import type { PacketDataFidelity, PacketInfo } from "@/types/packetCapture";
import { formatTimestampCompact } from "@/lib/dateTime";
import { EmptyState } from "@/components/ui/empty-state";
import {
  type ColumnId,
  type ColumnConfig,
  type SortColumn,
  type SortDirection,
  getGridTemplateColumns,
  getVisibleColumns,
  loadColumnConfigs,
  saveColumnConfigs,
  loadColumnOrder,
  saveColumnOrder,
  reorderVisibleColumns,
  resetPacketColumnsToDefaults,
} from "./packetColumns";
import {
  type PacketAnnotation,
  type PacketColorId,
  PACKET_COLORS,
  getPacketColor,
} from "@/stores/packetAnnotationStore";
import { getPacketRowTint, getProtocolLabelColor } from "./packetProtocolStyles";

/** Row height in px (fixed for virtualization). */
const ROW_HEIGHT = 28;
const OVERSCAN = 20;
/** When the scroll pane still reports 0 height, still paint this many rows so packets are visible. */
const FALLBACK_VISIBLE_ROWS = 250;

/** Map column ids to educational tooltip entries. */
const COLUMN_TOOLTIPS: Partial<Record<ColumnId, { title: string; description?: string }>> = {
  frameNumber: tooltips.colNumber,
  time: tooltips.colTime,
  source: tooltips.colSource,
  destination: tooltips.colDestination,
  protocol: tooltips.colProtocol,
  length: tooltips.colLength,
  info: tooltips.colInfo,
  srcMac: tooltips.colSrcMac,
  dstMac: tooltips.colDstMac,
  ttl: tooltips.colTtl,
  tcpFlags: tooltips.colTcpFlags,
  tcpSeq: tooltips.colTcpSeq,
  tcpAck: tooltips.colTcpAck,
  udpLength: tooltips.colUdpLen,
  checksum: tooltips.colChecksum,
};

/** SIP method → color. */
const SIP_METHOD_COLORS: Record<string, string> = {
  INVITE: "text-info", ACK: "text-success", BYE: "text-destructive",
  CANCEL: "text-warning", REGISTER: "text-success", OPTIONS: "text-info",
};
const SIP_OTHER_METHODS = new Set(["PRACK", "UPDATE", "INFO", "REFER", "NOTIFY", "SUBSCRIBE", "PUBLISH"]);

const DNS_RECORD_TYPES: Record<number, string> = {
  1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV",
};
const DNS_RESPONSE_CODES: Record<number, string> = {
  0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED",
};

// ── Props ─────────────────────────────────────────────────────────────

interface WarperPacketListProps {
  packets: PacketInfo[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  autoScroll?: boolean;
  onAutoScrollToggle?: () => void;
  totalCount?: number;
  windowOffset?: number;
  onRequestWindow?: (offset: number) => void;
  onDoubleClick?: (packet: PacketInfo, index: number) => void;
  renderRow?: (packet: PacketInfo, index: number, isSelected: boolean) => React.ReactNode;
  className?: string;
  /** Annotation lookup: index → annotation (marks/colors). */
  annotations?: Record<number, PacketAnnotation>;
  /** Called when user marks/unmarks a packet. */
  onToggleMark?: (index: number) => void;
  /** Called when user assigns a color to a packet. */
  onSetColor?: (index: number, colorId: PacketColorId | undefined) => void;
  /** Called when user clears all annotations for the current view. */
  onClearAnnotation?: (index: number) => void;
  /** Apply a display filter from context menu actions. */
  onApplyDisplayFilter?: (filter: string) => void;
  /** Optional callback for following RTP stream from context menu. */
  onFollowRtpStream?: (packet: PacketInfo) => void;
  /** Optional callback for following SIP dialog (Call-ID). */
  onFollowSipCall?: (packet: PacketInfo) => void;
  /** Optional callback for following 5-tuple conversation/stream. */
  onFollowConversation?: (packet: PacketInfo) => void;
}

// ── Row ───────────────────────────────────────────────────────────────

const PacketRow = memo(function PacketRow({
  packet,
  index,
  isSelected,
  onClick,
  onDoubleClick,
  onContextMenu,
  top,
  gridTemplate,
  visibleColumns,
  renderCell,
  annotation,
}: {
  packet: PacketInfo;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  top: number;
  gridTemplate: string;
  visibleColumns: ColumnConfig[];
  renderCell: (packet: PacketInfo, colId: ColumnId, index: number) => React.ReactNode;
  annotation?: PacketAnnotation;
}) {
  const protoBg = getPacketRowTint(packet);
  const colorDef = annotation?.colorId ? getPacketColor(annotation.colorId) : undefined;

  return (
    <div
      data-has-context-menu={onContextMenu ? "true" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "grid cursor-pointer select-none items-center gap-0 font-mono text-xs",
        "border-b border-[color:var(--ui-rule-list)] transition-smooth duration-[var(--motion-duration-micro)]",
        isSelected
          ? "border-l-2 border-l-primary bg-accent/55 text-accent-foreground"
          : colorDef
            ? cn(colorDef.bg, "border-l-2", colorDef.border, "hover:brightness-110")
            : cn(protoBg, "text-foreground hover:bg-accent/25"),
      )}
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        paddingLeft: (isSelected || colorDef) ? 6 : 8,
        paddingRight: 8,
        gridTemplateColumns: gridTemplate,
      }}
      role="row"
      aria-selected={isSelected}
    >
      {/* Mark indicator (overlaid on first column) */}
      {annotation?.marked && (
        <Bookmark
          className="absolute left-0.5 top-1/2 -translate-y-1/2 h-3 w-3 text-warning fill-warning z-10"
          aria-label="Marked"
        />
      )}
      {visibleColumns.map((col, colIdx) => (
        <div
          key={col.id}
          className={cn(
            "min-w-0 truncate px-1",
            colIdx > 0 && "border-l border-border/70",
          )}
        >
          {renderCell(packet, col.id, index)}
        </div>
      ))}
    </div>
  );
});

// ── Main Component ────────────────────────────────────────────────────

export function WarperPacketList({
  packets,
  selectedIndex,
  onSelect,
  autoScroll = true,
  onAutoScrollToggle,
  totalCount,
  windowOffset = 0,
  onDoubleClick,
  renderRow,
  className,
  annotations,
  onToggleMark,
  onSetColor,
  onClearAnnotation,
  onApplyDisplayFilter,
  onFollowRtpStream,
  onFollowSipCall,
  onFollowConversation,
}: WarperPacketListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; packetIdx: number } | null>(null);

  // ── Column state ──────────────────────────────────────────────────

  const [columnConfigs, setColumnConfigs] = useState<Record<ColumnId, ColumnConfig>>(
    () => loadColumnConfigs(),
  );
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(
    () => loadColumnOrder(),
  );
  const columnConfigsRef = useRef(columnConfigs);
  columnConfigsRef.current = columnConfigs;
  const packetListRootRef = useRef<HTMLDivElement | null>(null);
  const [resizingColumn, setResizingColumn] = useState<ColumnId | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const draggedColumnRef = useRef<ColumnId | null>(null);
  /** Synced on pointermove for reliable drop target on pointerup (React state may lag). */
  const dragOverColumnRef = useRef<ColumnId | null>(null);
  /** Resize guide X relative to packet list root (not viewport — avoids offset with layout chrome). */
  const [resizeGuideLeft, setResizeGuideLeft] = useState<number | null>(null);
  const headerGridRef = useRef<HTMLDivElement | null>(null);
  const headerCellRefs = useRef<Partial<Record<ColumnId, HTMLDivElement | null>>>({});
  const previousHeaderPositionsRef = useRef<Partial<Record<ColumnId, DOMRect>>>({});

  useEffect(() => { saveColumnConfigs(columnConfigs); }, [columnConfigs]);
  useEffect(() => { saveColumnOrder(columnOrder); }, [columnOrder]);

  // Ensure frameNumber always in order
  useEffect(() => {
    if (columnConfigs.frameNumber.visible && !columnOrder.includes("frameNumber")) {
      setColumnOrder(prev => ["frameNumber", ...prev]);
    }
  }, [columnConfigs.frameNumber.visible, columnOrder]);

  const visibleColumns = useMemo(
    () => getVisibleColumns(columnConfigs, columnOrder),
    [columnConfigs, columnOrder],
  );
  const visibleColumnsRef = useRef(visibleColumns);
  visibleColumnsRef.current = visibleColumns;

  const gridTemplate = useMemo(
    () => getGridTemplateColumns(visibleColumns, columnConfigs),
    [visibleColumns, columnConfigs],
  );

  // ── Column actions ────────────────────────────────────────────────

  const setColumnVisible = useCallback((colId: ColumnId, visible: boolean) => {
    if (colId === "frameNumber") return;
    setColumnConfigs(prev => ({
      ...prev,
      [colId]: { ...prev[colId], visible },
    }));
    setColumnOrder(prev => {
      if (!visible) return prev.filter(id => id !== colId);
      return prev.includes(colId) ? prev : [...prev, colId];
    });
  }, []);

  const resetColumnsToDefaults = useCallback(() => {
    const { configs, order } = resetPacketColumnsToDefaults();
    setColumnConfigs(configs);
    setColumnOrder(order);
  }, []);

  const handleSort = useCallback((colId: ColumnId) => {
    if (!columnConfigs[colId].sortable) return;
    setSortColumn(prev => {
      if (prev === colId) {
        setSortDirection(d => d === "asc" ? "desc" : d === "desc" ? null : "asc");
        if (sortDirection === "desc") return null;
        return colId;
      }
      setSortDirection("asc");
      return colId;
    });
  }, [columnConfigs, sortDirection]);

  const moveVisibleColumn = useCallback((colId: ColumnId, direction: "up" | "down") => {
    if (colId === "frameNumber") return;
    const currentIndex = visibleColumns.findIndex((col) => col.id === colId);
    if (currentIndex === -1) return;
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    // keep frame number pinned to the first position
    if (nextIndex < 1 || nextIndex >= visibleColumns.length) return;

    const current = visibleColumns[currentIndex]?.id;
    const target = visibleColumns[nextIndex]?.id;
    if (!current || !target) return;
    setColumnOrder((prev) =>
      reorderVisibleColumns(prev, visibleColumns.map((col) => col.id), current, target),
    );
  }, [visibleColumns]);

  const orderedColumns = useMemo(() => {
    const fromOrder: ColumnId[] = [...columnOrder, ...Object.keys(columnConfigs) as ColumnId[]];
    const seen = new Set<ColumnId>();
    const ordered: ColumnConfig[] = [];
    for (const id of fromOrder) {
      if (seen.has(id)) continue;
      const cfg = columnConfigs[id];
      if (!cfg) continue;
      seen.add(id);
      ordered.push(cfg);
    }
    return ordered;
  }, [columnOrder, columnConfigs]);

  const handlePointerDragStart = useCallback((colId: ColumnId) => {
    if (colId === "frameNumber") return;
    draggedColumnRef.current = colId;
    dragOverColumnRef.current = null;
    setDraggedColumn(colId);
    setDragOverColumn(null);
  }, []);

  useEffect(() => {
    if (!draggedColumn) return;

    const onPointerMove = (e: PointerEvent) => {
      const headerRect = headerGridRef.current?.getBoundingClientRect();
      if (!headerRect) return;
      if (e.clientY < headerRect.top - 8 || e.clientY > headerRect.bottom + 8) {
        dragOverColumnRef.current = null;
        setDragOverColumn(null);
        return;
      }

      const dragId = draggedColumnRef.current;
      let hovered: ColumnId | null = null;
      const cols = visibleColumnsRef.current;
      for (const col of cols) {
        if (col.id === "frameNumber") continue;
        const rect = headerCellRefs.current[col.id]?.getBoundingClientRect();
        if (!rect) continue;
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          hovered = col.id;
          break;
        }
      }
      if (!hovered || hovered === dragId) {
        dragOverColumnRef.current = null;
        setDragOverColumn(null);
        return;
      }
      dragOverColumnRef.current = hovered;
      setDragOverColumn(hovered);
    };

    const endDrag = () => {
      const dragId = draggedColumnRef.current;
      const dropTarget = dragOverColumnRef.current;
      if (dragId && dropTarget && dragId !== dropTarget) {
        const vis = visibleColumnsRef.current.map((c) => c.id);
        setColumnOrder((prev) => reorderVisibleColumns(prev, vis, dragId, dropTarget));
      }
      dragOverColumnRef.current = null;
      draggedColumnRef.current = null;
      setDraggedColumn(null);
      setDragOverColumn(null);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
    };
  }, [draggedColumn]);

  useLayoutEffect(() => {
    if (resizingColumn) {
      const immediatePositions: Partial<Record<ColumnId, DOMRect>> = {};
      for (const col of visibleColumns) {
        const el = headerCellRefs.current[col.id];
        if (el) immediatePositions[col.id] = el.getBoundingClientRect();
      }
      previousHeaderPositionsRef.current = immediatePositions;
      return;
    }

    const nextPositions: Partial<Record<ColumnId, DOMRect>> = {};
    for (const col of visibleColumns) {
      const el = headerCellRefs.current[col.id];
      if (el) nextPositions[col.id] = el.getBoundingClientRect();
    }

    const prevPositions = previousHeaderPositionsRef.current;
    for (const col of visibleColumns) {
      const id = col.id;
      const prev = prevPositions[id];
      const next = nextPositions[id];
      const el = headerCellRefs.current[id];
      if (!prev || !next || !el) continue;
      const dx = prev.left - next.left;
      if (Math.abs(dx) < 1) continue;
      el.animate(
        [
          { transform: `translateX(${dx}px)` },
          { transform: "translateX(0)" },
        ],
        {
          duration: 160,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    }

    previousHeaderPositionsRef.current = nextPositions;
  }, [visibleColumns, resizingColumn]);

  // ── Resize ────────────────────────────────────────────────────────

  const resizeRafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<{
    leftId: ColumnId;
    leftWidth: number;
    rightId: ColumnId | null;
    rightWidth: number | null;
  } | null>(null);
  const resizeStartRef = useRef<{
    x: number;
    leftId: ColumnId;
    leftWidth: number;
    rightId: ColumnId | null;
    rightWidth: number | null;
  } | null>(null);
  const syncResizeGuideToClientX = useCallback((clientX: number) => {
    const root = packetListRootRef.current;
    if (!root) {
      setResizeGuideLeft(null);
      return;
    }
    const r = root.getBoundingClientRect();
    setResizeGuideLeft(clientX - r.left);
  }, []);

  useEffect(() => {
    if (!resizingColumn) return;
    const handlePointerMove = (e: PointerEvent) => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) return;
      syncResizeGuideToClientX(e.clientX);
      const deltaX = e.clientX - resizeStart.x;
      const MIN_W = 50;
      if (resizeStart.rightId && resizeStart.rightWidth != null) {
        const minDelta = MIN_W - resizeStart.leftWidth;
        const maxDelta = resizeStart.rightWidth - MIN_W;
        const boundedDelta = Math.max(minDelta, Math.min(maxDelta, deltaX));
        pendingWidthRef.current = {
          leftId: resizeStart.leftId,
          leftWidth: resizeStart.leftWidth + boundedDelta,
          rightId: resizeStart.rightId,
          rightWidth: resizeStart.rightWidth - boundedDelta,
        };
      } else {
        pendingWidthRef.current = {
          leftId: resizeStart.leftId,
          leftWidth: Math.max(MIN_W, resizeStart.leftWidth + deltaX),
          rightId: null,
          rightWidth: null,
        };
      }
      if (resizeRafRef.current == null) {
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const pending = pendingWidthRef.current;
          if (pending) {
            setColumnConfigs(prev => ({
              ...prev,
              [pending.leftId]: { ...prev[pending.leftId], width: pending.leftWidth },
              ...(pending.rightId && pending.rightWidth != null
                ? { [pending.rightId]: { ...prev[pending.rightId], width: pending.rightWidth } }
                : {}),
            }));
            pendingWidthRef.current = null;
          }
        });
      }
    };
    const handlePointerUp = () => {
      setResizeGuideLeft(null);
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      const pending = pendingWidthRef.current;
      if (pending) {
        setColumnConfigs(prev => ({
          ...prev,
          [pending.leftId]: { ...prev[pending.leftId], width: pending.leftWidth },
          ...(pending.rightId && pending.rightWidth != null
            ? { [pending.rightId]: { ...prev[pending.rightId], width: pending.rightWidth } }
            : {}),
        }));
        pendingWidthRef.current = null;
      }
      resizeStartRef.current = null;
      setResizingColumn(null);
    };
    const cap = { capture: true };
    document.addEventListener("pointermove", handlePointerMove, cap);
    document.addEventListener("pointerup", handlePointerUp, cap);
    document.addEventListener("pointercancel", handlePointerUp, cap);
    return () => {
      setResizeGuideLeft(null);
      document.removeEventListener("pointermove", handlePointerMove, cap);
      document.removeEventListener("pointerup", handlePointerUp, cap);
      document.removeEventListener("pointercancel", handlePointerUp, cap);
      if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current);
    };
  }, [resizingColumn, syncResizeGuideToClientX]);

  // ── Sort packets ──────────────────────────────────────────────────

  const sortedPackets = useMemo(() => {
    const indexed = packets.map((p, i) => ({ packet: p, idx: i }));
    if (!sortColumn || !sortDirection) return indexed;

    const getSortValue = (p: PacketInfo): string | number => {
      switch (sortColumn) {
        case "time": return p.timestamp || "";
        case "source": return p.srcIp || "";
        case "destination": return p.dstIp || "";
        case "protocol": return p.protocol || "";
        case "length": return p.size || p.frameLength || 0;
        case "frameNumber": return 0; // use idx
        case "srcMac": return p.decoded?.ethernet?.srcMac || "";
        case "dstMac": return p.decoded?.ethernet?.dstMac || "";
        case "ttl": return p.decoded?.ip?.ttl ?? 0;
        case "tcpSeq": return p.decoded?.tcp?.sequence ?? 0;
        case "tcpAck": return p.decoded?.tcp?.acknowledgment ?? 0;
        case "udpLength": return p.decoded?.udp?.length ?? 0;
        default: return "";
      }
    };

    const dir = sortDirection === "asc" ? 1 : -1;
    indexed.sort((a, b) => {
      const va = getSortValue(a.packet);
      const vb = getSortValue(b.packet);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return indexed;
  }, [packets, sortColumn, sortDirection]);

  // ── Cell renderer ─────────────────────────────────────────────────

  const renderCell = useCallback((packet: PacketInfo, columnId: ColumnId, index: number): React.ReactNode => {
    const config = columnConfigs[columnId];
    const alignClass = config.align === "right" ? "text-right" : config.align === "center" ? "text-center" : "";
    const protoColor = getProtocolLabelColor(packet.protocol);

    switch (columnId) {
      case "frameNumber":
        return <span className={cn("text-muted-foreground tabular-nums", alignClass)}>{index + 1}</span>;
      case "time":
        return <span className={cn("text-muted-foreground tabular-nums", alignClass)}>{formatTimestampCompact(packet.timestamp)}</span>;
      case "source":
        return (
          <span className={cn("min-w-0 block", alignClass)}>
            <IpAddress
              ip={formatIpPortEndpoint(packet.srcIp, packet.srcPort)}
              variant="mono"
              size="sm"
              showCopyOnHover
              showIpInfo={false}
              truncate
            />
          </span>
        );
      case "destination":
        return (
          <span className={cn("min-w-0 block", alignClass)}>
            <IpAddress
              ip={formatIpPortEndpoint(packet.dstIp, packet.dstPort)}
              variant="mono"
              size="sm"
              showCopyOnHover
              showIpInfo={false}
              truncate
            />
          </span>
        );
      case "protocol":
        const fidelity = getPacketFidelity(packet);
        const nonAuthoritative = fidelity !== undefined && fidelity !== "authoritative";
        const fidelityTag = fidelity === "simulated" ? "SIM" : nonAuthoritative ? "NA" : null;
        return (
          <span className={cn("font-semibold inline-flex items-center gap-1", protoColor, alignClass)}>
            <span>{packet.protocol}</span>
            {fidelityTag && (
              <TooltipWrapper
                entry={{
                  title: "Non-authoritative packet",
                  description:
                    fidelity === "simulated"
                      ? "Simulated packet data (not direct wire capture)."
                      : "This packet is non-authoritative and should be treated as derived data.",
                }}
              >
                <span className="text-[10px] leading-none px-1 rounded border border-warning/40 text-warning">
                  {fidelityTag}
                </span>
              </TooltipWrapper>
            )}
          </span>
        );
      case "length":
        return <span className={cn("text-muted-foreground tabular-nums", alignClass)}>{packet.size || packet.frameLength || 0}</span>;
      case "info": {
        const info = getPacketInfo(packet);
        const color = getInfoColor(packet, info);
        return <span className={cn("text-muted-foreground truncate", alignClass)}><span className={cn("font-semibold", color)}>{info}</span></span>;
      }
      case "srcMac":
        return <span className={cn("text-muted-foreground font-mono", alignClass)}>{packet.decoded?.ethernet?.srcMac || "—"}</span>;
      case "dstMac":
        return <span className={cn("text-muted-foreground font-mono", alignClass)}>{packet.decoded?.ethernet?.dstMac || "—"}</span>;
      case "ttl":
        return <span className={cn("text-muted-foreground", alignClass)}>{packet.decoded?.ip?.ttl ?? "—"}</span>;
      case "tcpFlags": {
        const flags = packet.decoded?.tcp?.flags;
        return <span className={cn("text-muted-foreground text-2xs", alignClass)}>{flags !== undefined ? getTcpFlags(flags) : "—"}</span>;
      }
      case "tcpSeq":
        return <span className={cn("text-muted-foreground font-mono", alignClass)}>{packet.decoded?.tcp?.sequence ? `0x${packet.decoded.tcp.sequence.toString(16)}` : "—"}</span>;
      case "tcpAck":
        return <span className={cn("text-muted-foreground font-mono", alignClass)}>{packet.decoded?.tcp?.acknowledgment ? `0x${packet.decoded.tcp.acknowledgment.toString(16)}` : "—"}</span>;
      case "udpLength":
        return <span className={cn("text-muted-foreground", alignClass)}>{packet.decoded?.udp?.length ?? "—"}</span>;
      case "checksum": {
        const cs = packet.decoded?.ip?.checksum || packet.decoded?.tcp?.checksum || packet.decoded?.udp?.checksum;
        return <span className={cn("text-muted-foreground font-mono text-2xs", alignClass)}>{cs ? `0x${cs.toString(16)}` : "—"}</span>;
      }
      default:
        return null;
    }
  }, [columnConfigs]);

  // ── Scroll / virtualizer ──────────────────────────────────────────

  // Measure scroll container. If the first layout runs while the list is inside
  // `display: none` (e.g. inactive Radix TabsContent), clientHeight stays 0 and the
  // virtualizer renders zero rows forever unless we remeasure when visible/size changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const measure = () => {
      const node = scrollRef.current;
      if (!node) return;
      const h = node.clientHeight;
      setContainerHeight((prev) => (h !== prev ? h : prev));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) measure();
        }
      },
      { root: null, threshold: 0 },
    );
    io.observe(el);

    measure();
    const raf = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  // Packets can arrive before flex layout gives the scroll pane a height; remeasure when data shows up.
  useLayoutEffect(() => {
    if (sortedPackets.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const h = el.clientHeight;
    if (h <= 0) return;
    setContainerHeight((prev) => (h !== prev ? h : prev));
  }, [sortedPackets.length]);

  // RAF-throttled scroll tracking
  const rafRef = useRef(0);
  const handleScrollEvent = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const totalHeight = sortedPackets.length * ROW_HEIGHT;

  // Visible range — O(1). If containerHeight is still 0 (hidden tab, incomplete flex layout),
  // render a capped window so rows are not clipped to zero.
  const startIdx = useMemo(() => {
    if (sortedPackets.length === 0) return 0;
    if (containerHeight <= 0) return 0;
    return Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  }, [scrollTop, containerHeight, sortedPackets.length]);

  const endIdx = useMemo(() => {
    if (sortedPackets.length === 0) return 0;
    if (containerHeight <= 0) {
      return Math.min(sortedPackets.length, FALLBACK_VISIBLE_ROWS);
    }
    return Math.min(sortedPackets.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  }, [scrollTop, containerHeight, sortedPackets.length]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && sortedPackets.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = totalHeight;
    }
  }, [autoScroll, sortedPackets.length, totalHeight]);

  // Scroll selected into view
  useEffect(() => {
    if (selectedIndex == null || selectedIndex < 0 || !scrollRef.current) return;
    const el = scrollRef.current;
    const top = selectedIndex * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [selectedIndex]);

  // ── Context menu handlers ──
  const handleContextMenu = useCallback((e: React.MouseEvent, packetIdx: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, packetIdx });
    onSelect(packetIdx);
  }, [onSelect]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Keyboard navigation (+ M to mark, 1-8 for colors)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); onAutoScrollToggle?.(); return; }

      // M to toggle mark on selected packet
      if ((e.key === "m" || e.key === "M") && selectedIndex != null && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onToggleMark?.(selectedIndex);
        return;
      }

      // 1-8 to apply color, 0 to clear color
      if (/^[0-8]$/.test(e.key) && selectedIndex != null && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (e.key === "0") {
          onSetColor?.(selectedIndex, undefined);
        } else {
          const colorIdx = parseInt(e.key, 10) - 1;
          const color = PACKET_COLORS[colorIdx];
          if (color) onSetColor?.(selectedIndex, color.id);
        }
        return;
      }

      if (selectedIndex == null) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (packets.length > 0) onSelect(0); }
        return;
      }
      let n = selectedIndex;
      switch (e.key) {
        case "ArrowUp":   n = Math.max(0, n - 1); break;
        case "ArrowDown":  n = Math.min(packets.length - 1, n + 1); break;
        case "PageUp":     n = Math.max(0, n - 20); break;
        case "PageDown":   n = Math.min(packets.length - 1, n + 20); break;
        case "Home":       n = 0; break;
        case "End":        n = packets.length - 1; break;
        case "Escape":     onSelect(-1); e.preventDefault(); return;
        case "Enter":
          if (onDoubleClick && packets[selectedIndex]) onDoubleClick(packets[selectedIndex], selectedIndex);
          e.preventDefault();
          return;
        default: return;
      }
      e.preventDefault();
      if (n !== selectedIndex) onSelect(n);
    },
    [selectedIndex, packets, onSelect, onAutoScrollToggle, onDoubleClick, onToggleMark, onSetColor],
  );

  // Build visible rows
  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const item = sortedPackets[i];
      if (!item) continue;
      const gIdx = windowOffset + item.idx;

      if (renderRow) {
        out.push(
          <div key={i} style={{ position: "absolute", top: i * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}>
            {renderRow(item.packet, gIdx, item.idx === selectedIndex)}
          </div>,
        );
      } else {
        out.push(
          <PacketRow
            key={i}
            packet={item.packet}
            index={gIdx}
            isSelected={item.idx === selectedIndex}
            onClick={() => onSelect(item.idx)}
            onDoubleClick={onDoubleClick ? () => onDoubleClick(item.packet, gIdx) : undefined}
            onContextMenu={onToggleMark || onSetColor || onApplyDisplayFilter || onFollowRtpStream || onFollowSipCall || onFollowConversation ? (e) => handleContextMenu(e, item.idx) : undefined}
            top={i * ROW_HEIGHT}
            gridTemplate={gridTemplate}
            visibleColumns={visibleColumns}
            renderCell={renderCell}
            annotation={annotations?.[item.idx]}
          />,
        );
      }
    }
    return out;
  }, [startIdx, endIdx, sortedPackets, selectedIndex, windowOffset, onSelect, onDoubleClick, renderRow, gridTemplate, visibleColumns, renderCell, annotations, handleContextMenu, onToggleMark, onSetColor]);

  const displayCount = totalCount ?? packets.length;
  const contextPacketIdx = contextMenu?.packetIdx ?? -1;
  const contextPacket = contextPacketIdx >= 0 ? packets[contextPacketIdx] : undefined;
  const contextApp = contextPacket?.decoded?.application;
  const contextIsRtp = contextApp?.type === "Rtp" || contextApp?.type === "Srtp";
  const contextIsSip = (contextPacket?.protocol.toUpperCase() === "SIP") || contextApp?.type === "Sip";
  const contextHasPorts = !!contextPacket && contextPacket.srcPort > 0 && contextPacket.dstPort > 0;
  const contextIsUdpOrTcp = !!contextPacket && (
    contextPacket.protocol.toUpperCase() === "UDP" ||
    contextPacket.protocol.toUpperCase() === "TCP" ||
    !!contextPacket.decoded?.udp ||
    !!contextPacket.decoded?.tcp
  );
  const contextSipCallId = contextApp?.type === "Sip" ? contextApp.data.callId : null;
  const hasVoipActions = !!(onApplyDisplayFilter || onFollowRtpStream || onFollowSipCall || onFollowConversation);
  const showFollowConversation = contextIsUdpOrTcp && contextHasPorts;
  const showVoipSection = hasVoipActions && (contextIsRtp || contextIsSip || showFollowConversation);
  const contextAnnotation = contextPacketIdx >= 0 ? annotations?.[contextPacketIdx] : undefined;
  const canClearAnnotation = !!(contextAnnotation?.marked || contextAnnotation?.colorId);

  return (
    <div
      ref={packetListRootRef}
      className={cn("relative flex flex-col overflow-hidden", className)}
      style={{ height: "100%", minHeight: 0 }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="grid"
      aria-rowcount={displayCount}
    >
      {resizeGuideLeft != null && resizingColumn != null ? (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-[10050] w-px bg-primary/80 shadow-none"
          style={{ left: resizeGuideLeft }}
          aria-hidden
        />
      ) : null}
      {/* ── Column headers ── */}
      <div className="ui-section-header-sm group/header flex-none h-10 box-border select-none p-0">
        <div
          ref={headerGridRef}
          className={cn(
            "relative grid h-full items-center gap-0 overflow-visible text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground/80",
            draggedColumn && "cursor-grabbing",
          )}
          style={{ paddingLeft: 8, paddingRight: 32, gridTemplateColumns: gridTemplate }}
        >
          {visibleColumns.map((col, colIdx) => {
            const isSorted = sortColumn === col.id;
            const isFrameNumber = col.id === "frameNumber";

            return (
              <div
                key={col.id}
                ref={(node) => {
                  headerCellRefs.current[col.id] = node;
                }}
                className={cn(
                  "packet-list__col-head relative flex items-center h-full group/col min-w-0 px-1",
                  colIdx > 0 && "border-l border-border/70",
                  !resizingColumn && "transition-smooth",
                  draggedColumn === col.id && "z-20 rounded-sm bg-accent/45 opacity-65 scale-[0.985]",
                  dragOverColumn === col.id && "rounded-sm bg-accent/35",
                )}
                style={{
                  zIndex:
                    draggedColumn === col.id || dragOverColumn === col.id
                      ? 80 + (visibleColumns.length - colIdx)
                      : visibleColumns.length - colIdx,
                }}
              >
                {dragOverColumn === col.id && (
                  <div className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-foreground/45" />
                )}
                {!isFrameNumber && (
                  <button
                    type="button"
                    className={cn(
                      "mr-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded text-muted-foreground/65 transition-smooth",
                      "cursor-grab active:cursor-grabbing hover:text-foreground/85 hover:bg-accent/50",
                      draggedColumn === col.id && "cursor-grabbing text-foreground",
                      draggedColumn && draggedColumn !== col.id && "opacity-90",
                    )}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePointerDragStart(col.id);
                    }}
                    aria-label={`Drag ${col.label} column`}
                  >
                    <GripVertical className="h-2.5 w-2.5" />
                  </button>
                )}
                {col.sortable ? (
                  <button
                    onClick={() => handleSort(col.id)}
                    className={cn(
                      "flex items-center gap-0.5 truncate transition-smooth",
                      isSorted ? "text-foreground" : "hover:text-foreground/70",
                    )}
                  >
                    {COLUMN_TOOLTIPS[col.id] ? (
                      <TooltipWrapper entry={COLUMN_TOOLTIPS[col.id]!}>
                        <span className="truncate cursor-help">{col.label}</span>
                      </TooltipWrapper>
                    ) : (
                      <span className="truncate">{col.label}</span>
                    )}
                    {isSorted && (
                      sortDirection === "asc"
                        ? <ArrowUp className="h-2.5 w-2.5 shrink-0" />
                        : <ArrowDown className="h-2.5 w-2.5 shrink-0" />
                    )}
                  </button>
                ) : (
                  COLUMN_TOOLTIPS[col.id] ? (
                    <TooltipWrapper entry={COLUMN_TOOLTIPS[col.id]!}>
                      <span className="truncate cursor-help">{col.label}</span>
                    </TooltipWrapper>
                  ) : (
                    <span className="truncate">{col.label}</span>
                  )
                )}
                {/* Resize handle — only visible on hover */}
                <PanelResizeHandle
                  as="div"
                  orientation="vertical"
                  density="compact"
                  appearance="minimal"
                  label={`Resize ${col.label} column`}
                  className={cn(
                    "packet-list__col-resize",
                    resizingColumn === col.id && "is-resizing",
                  )}
                  onPointerDown={(e) => {
                    if (e.button !== 0 && e.button !== -1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    syncResizeGuideToClientX(e.clientX);
                    const cols = visibleColumnsRef.current;
                    const idx = cols.findIndex((c) => c.id === col.id);
                    const next = idx >= 0 ? cols[idx + 1] : undefined;
                    const cfg = columnConfigsRef.current;
                    resizeStartRef.current = {
                      x: e.clientX,
                      leftId: col.id,
                      leftWidth: cfg[col.id].width,
                      rightId: next?.id ?? null,
                      rightWidth: next ? cfg[next.id].width : null,
                    };
                    setResizingColumn(col.id);
                  }}
                />
              </div>
            );
          })}

          {/* Column visibility settings */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 z-30">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="neutral"
                  size="sm"
                  className="h-5 w-5 p-0 transition-smooth"
                >
                  <Settings2 className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64" sideOffset={6}>
                <DropdownMenuItem className="gap-2 text-xs" onSelect={() => resetColumnsToDefaults()}>
                  <RotateCcw className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  Reset to default columns
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {orderedColumns.map((col) => {
                  const visibleIndex = visibleColumns.findIndex((v) => v.id === col.id);
                  const canMoveUp = col.visible && col.id !== "frameNumber" && visibleIndex > 1;
                  const canMoveDown = col.visible && col.id !== "frameNumber" && visibleIndex >= 1 && visibleIndex < visibleColumns.length - 1;
                  return (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.visible}
                    disabled={col.id === "frameNumber"}
                    onCheckedChange={(checked) => {
                      if (col.id === "frameNumber") return;
                      const next = checked === true;
                      if (next === col.visible) return;
                      setColumnVisible(col.id, next);
                    }}
                    onSelect={(e) => e.preventDefault()}
                    className="gap-0 py-1.5 pr-1.5 text-xs"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className={cn("min-w-0 flex-1 truncate", !col.visible && "text-muted-foreground")}>
                        {col.label}
                      </span>
                      {col.id === "frameNumber" && (
                        <span className="shrink-0 text-2xs text-muted-foreground">(locked)</span>
                      )}
                      {col.visible && col.id !== "frameNumber" && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent disabled:opacity-35"
                            disabled={!canMoveUp}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              moveVisibleColumn(col.id, "up");
                            }}
                            aria-label={`Move ${col.label} column left`}
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent disabled:opacity-35"
                            disabled={!canMoveDown}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              moveVisibleColumn(col.id, "down");
                            }}
                            aria-label={`Move ${col.label} column right`}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </span>
                  </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* ── Scroll area ── */}
      <div className="surface-flat relative flex-1" style={{ minHeight: 0 }}>
        <div
          ref={scrollRef}
          onScroll={handleScrollEvent}
          className="absolute inset-0 overflow-auto"
        >
          {sortedPackets.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={<Scan />}
              title="No packets to display"
              description="Start or load a capture to populate the packet list."
              className="h-full p-6"
            />
          ) : (
            <div style={{ position: "relative", height: totalHeight }} role="rowgroup">
              {rows}
            </div>
          )}
        </div>
        <ScrollFloatingButtons scrollRef={scrollRef} />
      </div>

      {/* ── Packet Context Menu (Radix dropdown anchored at cursor) ── */}
      <DropdownMenu
        open={!!contextMenu}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeContextMenu();
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed h-px w-px opacity-0"
            style={{
              left: contextMenu?.x ?? 0,
              top: contextMenu?.y ?? 0,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={4}
          className="w-56 max-h-[480px]"
        >
          {contextPacket && (
            <>
              {showVoipSection && (
                <>
                  {contextIsRtp && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (onFollowRtpStream) {
                          onFollowRtpStream(contextPacket);
                        } else if (onApplyDisplayFilter && contextApp && (contextApp.type === "Rtp" || contextApp.type === "Srtp")) {
                          onApplyDisplayFilter(`rtp.ssrc == ${contextApp.data.ssrc}`);
                        }
                        closeContextMenu();
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      Follow RTP Stream
                    </DropdownMenuItem>
                  )}

                  {contextIsSip && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (onFollowSipCall) {
                          onFollowSipCall(contextPacket);
                        } else if (onApplyDisplayFilter && contextSipCallId) {
                          onApplyDisplayFilter(`sip.Call-ID == "${contextSipCallId}"`);
                        } else if (onApplyDisplayFilter) {
                          onApplyDisplayFilter("sip");
                        }
                        closeContextMenu();
                      }}
                    >
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      Follow SIP Dialog
                    </DropdownMenuItem>
                  )}

                  {showFollowConversation && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (onFollowConversation) {
                          onFollowConversation(contextPacket);
                        } else if (onApplyDisplayFilter) {
                          const proto = contextPacket.decoded?.tcp || contextPacket.protocol.toUpperCase() === "TCP" ? "tcp" : "udp";
                          onApplyDisplayFilter(
                            `${proto} && ((ip.src == ${contextPacket.srcIp} && ip.dst == ${contextPacket.dstIp} && ${proto}.srcport == ${contextPacket.srcPort} && ${proto}.dstport == ${contextPacket.dstPort}) || (ip.src == ${contextPacket.dstIp} && ip.dst == ${contextPacket.srcIp} && ${proto}.srcport == ${contextPacket.dstPort} && ${proto}.dstport == ${contextPacket.srcPort}))`
                          );
                        }
                        closeContextMenu();
                      }}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                      Follow Conversation
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuItem
                onSelect={() => {
                  onToggleMark?.(contextPacketIdx);
                  closeContextMenu();
                }}
              >
                <Bookmark className={cn("h-3.5 w-3.5", contextAnnotation?.marked ? "text-warning fill-warning" : "text-muted-foreground")} />
                {contextAnnotation?.marked ? "Unmark Packet" : "Mark Packet"}
                <DropdownMenuShortcut>M</DropdownMenuShortcut>
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                  Colorize
                  <DropdownMenuShortcut>1-8</DropdownMenuShortcut>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {PACKET_COLORS.map((color, idx) => (
                    <DropdownMenuItem
                      key={color.id}
                      onSelect={() => {
                        onSetColor?.(contextPacketIdx, color.id);
                        closeContextMenu();
                      }}
                    >
                      <span className={cn("h-3 w-3 rounded-full shrink-0", color.dot)} />
                      {color.label}
                      <DropdownMenuShortcut>{idx + 1}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))}
                  {contextAnnotation?.colorId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          onSetColor?.(contextPacketIdx, undefined);
                          closeContextMenu();
                        }}
                        className="text-muted-foreground"
                      >
                        <X className="h-3 w-3" />
                        Remove Color
                        <DropdownMenuShortcut>0</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {canClearAnnotation && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      onClearAnnotation?.(contextPacketIdx);
                      closeContextMenu();
                    }}
                    className="text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                    Clear All Annotations
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Helpers (static, no re-creation) ──────────────────────────────────

function getPacketInfo(packet: PacketInfo): string {
  if (packet.decoded?.application) {
    const app = packet.decoded.application;
    if (app.type === "Sip") {
      if (app.data.method) return app.data.method.toUpperCase();
      if (app.data.responseCode) {
        const code = app.data.responseCode;
        const text = (app.data.responseText || "").trim();
        return text ? `${code} ${text}` : `${code}`;
      }
      if (packet.summary) {
        const m = packet.summary.match(/SIP\s+(\d+\s+\w+|\w+)(?=\s|$)/);
        if (m) return (m[1] ?? "").trim();
      }
      return "SIP";
    }
    if (app.type === "Rtp" || app.type === "Srtp") {
      const prefix = app.type === "Srtp" ? "SRTP" : "RTP";
      if (app.data.dtmfEvent) return `${prefix} DTMF '${app.data.dtmfEvent.digit}' SSRC:0x${app.data.ssrc.toString(16)}`;
      return `${prefix} PT:${app.data.payloadType} SSRC:0x${app.data.ssrc.toString(16)}`;
    }
    if (app.type === "Dns") {
      const dns = app.data as any;
      if (dns.isResponse) {
        const codeName = DNS_RESPONSE_CODES[dns.responseCode ?? 0] || `RCODE${dns.responseCode ?? 0}`;
        if (dns.answers?.length) {
          const a = dns.answers[0];
          if (!a) return `DNS ${codeName}`;
          const rt = DNS_RECORD_TYPES[a.rtype ?? 0] || `TYPE${a.rtype ?? 0}`;
          return dns.answers.length === 1
            ? `${codeName} ${a.name} → ${a.data} (${rt})`
            : `${codeName} ${a.name} → ${a.data} (${rt}, +${dns.answers.length - 1})`;
        }
        if (dns.queries?.length) return `${codeName} ${dns.queries[0]?.name ?? ""}`;
        return `DNS ${codeName}`;
      }
      if (dns.queries?.length) {
        const q = dns.queries[0];
        if (!q) return "DNS Query";
        const rt = DNS_RECORD_TYPES[q.qtype ?? 0] || `TYPE${q.qtype ?? 0}`;
        return dns.queries.length === 1
          ? `Query ${q.name} (${rt})`
          : `Query ${q.name} (${rt}, +${dns.queries.length - 1})`;
      }
      return "DNS Query";
    }
    if (app.type === "T38") return `T.38 ${app.data.ifpType ?? "UDPTL"} seq ${app.data.seq ?? 0}`;
  }
  if (packet.protocol === "DNS" && packet.summary) {
    const m = packet.summary.match(/DNS\s+([^\s]+)/);
    if (m) return `DNS ${m[1]}`;
    return "DNS";
  }
  if (packet.protocol === "SIP" && packet.summary) {
    const m = packet.summary.match(/SIP\s+(\d+\s+\w+|\w+)(?=\s|$)/);
    if (m) return (m[1] ?? "").trim();
  }
  if (packet.protocol === "FAX") {
    if (packet.summary) {
      const m = packet.summary.match(/T\.38\s+(\S+)\s+seq\s+(\d+)/);
      if (m) return `T.38 ${m[1]} seq ${m[2]}`;
    }
    return "T.38 UDPTL";
  }
  if (["ICMP", "ARP", "Other"].includes(packet.protocol))
    return `${packet.protocol} ${packet.srcIp} -> ${packet.dstIp}`;
  return `${packet.protocol} ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`;
}

function getPacketFidelity(packet: PacketInfo): PacketDataFidelity | undefined {
  const normalizedProvenance =
    packet.dataProvenance ??
    (packet.provenance && typeof packet.provenance === "object" ? packet.provenance : undefined);
  return packet.dataFidelity ?? packet.fidelity ?? normalizedProvenance?.fidelity;
}

function getInfoColor(packet: PacketInfo, info: string): string {
  const sipMethod = info.toUpperCase();
  const mc = SIP_METHOD_COLORS[sipMethod];
  if (mc) return mc;
  if (SIP_OTHER_METHODS.has(sipMethod)) return "text-warning";
  if (/^\d{3}/.test(info)) {
    const code = parseInt(info.substring(0, 3), 10);
    if (code >= 200 && code < 300) return "text-success";
    if (code >= 300 && code < 400) return "text-warning";
    if (code >= 400 && code < 500) return "text-warning";
    if (code >= 500 && code < 600) return "text-destructive";
    if (code >= 100 && code < 200) return "text-info";
  }
  if (info.startsWith("RTP")) return "text-success";
  if (info.startsWith("T.38")) return "text-warning";
  return getProtocolLabelColor(packet.protocol);
}

function getTcpFlags(flags: number): string {
  const n: string[] = [];
  if (flags & 0x01) n.push("FIN");
  if (flags & 0x02) n.push("SYN");
  if (flags & 0x04) n.push("RST");
  if (flags & 0x08) n.push("PSH");
  if (flags & 0x10) n.push("ACK");
  if (flags & 0x20) n.push("URG");
  return n.join(",") || "None";
}

export default WarperPacketList;
