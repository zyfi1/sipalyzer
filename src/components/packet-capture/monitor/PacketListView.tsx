import { useVirtualizer } from "@tanstack/react-virtual";
import { type ColumnDef, type SortingFn } from "@tanstack/react-table";
import { useRef, useEffect, useState, useMemo, useCallback, useLayoutEffect, startTransition, memo } from "react";
import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PanelResizeHandle } from "@/components/ui/panel-chrome";
import { Settings2, ArrowUp, ArrowDown, ArrowUpDown, GripVertical, ChevronLeft, ChevronRight, RotateCcw } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { IpAddress } from "@/components/ui/IpAddress";
import type { PacketInfo } from "@/types/packetCapture";
import { PacketContextMenu } from "./PacketContextMenu";
import { ScrollFloatingButtons } from "./ScrollFloatingButtons";
import { formatTimestampCompact } from "@/lib/dateTime";
import { formatIpPortEndpoint } from "@/lib/networkUtils";
import { useUnifiedTable } from "@/lib/table/useUnifiedTable";
import { EmptyState } from "@/components/ui/empty-state";

interface PacketListViewProps {
  packets: PacketInfo[];
  selectedPacketIndex: number | null;
  onSelectPacket: (index: number) => void;
  autoScroll: boolean;
  onApplyFilter?: (filter: string) => void;
  onPrepareFilter?: (filter: string) => void;
  onCopy?: (text: string) => void;
  onFollowStream?: (packet: PacketInfo) => void;
  onFollowConversation?: (packet: PacketInfo) => void;
  onColorize?: (packetIndex: number, color: string) => void;
  onShowStatistics?: (packet: PacketInfo) => void;
  onExport?: (packet: PacketInfo) => void;
  onOpenInSipLadder?: () => void;
  packetColors?: Map<number, string>;
  /** Windowed mode: total packets in capture */
  totalPacketCount?: number | null;
  /** Windowed mode: start index of current window */
  windowStart?: number;
  /** Windowed mode: load window at offset */
  onRequestWindow?: (offset: number) => void;
  /** Windowed mode: window size */
  windowSize?: number;
}

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
import { getPacketRowTint, getProtocolLabelColor } from "./packetProtocolStyles";

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

// Static data structures for performance (created once, reused across renders)
const SIP_OTHER_METHODS = new Set(["PRACK", "UPDATE", "INFO", "REFER", "NOTIFY", "SUBSCRIBE", "PUBLISH"]);
const SIP_METHOD_COLORS: Record<string, string> = {
  "INVITE": "text-info",
  "ACK": "text-success",
  "BYE": "text-destructive",
  "CANCEL": "text-warning",
  "REGISTER": "text-success",
  "OPTIONS": "text-info",
};
const PACKET_COLOR_MAP: Record<string, string> = {
  red: "rgba(239, 68, 68, 0.15)",
  orange: "rgba(249, 115, 22, 0.15)",
  yellow: "rgba(234, 179, 8, 0.15)",
  green: "rgba(34, 197, 94, 0.15)",
  blue: "rgba(59, 130, 246, 0.15)",
  teal: "rgba(20, 184, 166, 0.15)",
};

interface PacketListRowProps {
  sortedItem: { packet: PacketInfo; originalIndex: number };
  isSelected: boolean;
  gridTemplateColumns: string;
  packetColors: Map<number, string>;
  onSelectPacket: (index: number) => void;
  visibleColumns: { id: ColumnId }[];
  renderCell: (packet: PacketInfo, colId: ColumnId, sortedItem: { packet: PacketInfo; originalIndex: number }) => React.ReactNode;
  onApplyFilter?: (filter: string) => void;
  onPrepareFilter?: (filter: string) => void;
  onCopy?: (text: string) => void;
  onFollowStream?: (packet: PacketInfo) => void;
  onFollowConversation?: (packet: PacketInfo) => void;
  onColorize?: (packetIndex: number, color: string) => void;
  onShowStatistics?: (packet: PacketInfo) => void;
  onExport?: (packet: PacketInfo) => void;
  onOpenInSipLadder?: () => void;
  rowStyle: React.CSSProperties;
}

type PacketTableRow = { packet: PacketInfo; originalIndex: number };

const ipSortingFn: SortingFn<PacketTableRow> = (rowA, rowB, columnId) =>
  String(rowA.getValue(columnId)).localeCompare(String(rowB.getValue(columnId)), undefined, { numeric: true });

const PacketListRow = memo(function PacketListRow({
  sortedItem,
  isSelected,
  gridTemplateColumns,
  packetColors,
  onSelectPacket,
  visibleColumns,
  renderCell,
  onApplyFilter,
  onPrepareFilter,
  onCopy,
  onFollowStream,
  onFollowConversation,
  onColorize,
  onShowStatistics,
  onExport,
  onOpenInSipLadder,
  rowStyle,
}: PacketListRowProps) {
  const packet = sortedItem.packet;
  const backgroundColor = packetColors.get(sortedItem.originalIndex);
  const protocolTintClass = getPacketRowTint(packet);
  return (
    <div
      data-index={sortedItem.originalIndex}
      data-has-context-menu
      style={{
        ...rowStyle,
        gridTemplateColumns,
        backgroundColor: backgroundColor && backgroundColor !== "none" ? PACKET_COLOR_MAP[backgroundColor] : undefined,
      }}
      className={cn(
        "grid gap-1.5 px-3 py-2 border-b border-border/40",
        "hover:bg-accent/50 transition-smooth cursor-pointer group",
        !backgroundColor && protocolTintClass,
        isSelected && "bg-accent border-l-2 border-l-primary"
      )}
      onClick={() => onSelectPacket(sortedItem.originalIndex)}
    >
      <PacketContextMenu
        packet={packet}
        packetIndex={sortedItem.originalIndex}
        onApplyFilter={onApplyFilter}
        onPrepareFilter={onPrepareFilter}
        onCopy={onCopy}
        onFollowStream={onFollowStream}
        onFollowConversation={onFollowConversation}
        onColorize={onColorize}
        onShowStatistics={onShowStatistics}
        onExport={onExport}
        onOpenInSipLadder={onOpenInSipLadder}
      >
        <div className="contents">
          {visibleColumns.map((col) => (
            <div key={col.id}>
              {renderCell(packet, col.id, sortedItem)}
            </div>
          ))}
        </div>
      </PacketContextMenu>
    </div>
  );
});

function PacketListViewInner({
  packets,
  selectedPacketIndex,
  onSelectPacket,
  autoScroll,
  onApplyFilter,
  onPrepareFilter,
  onCopy,
  onFollowStream,
  onFollowConversation,
  onColorize,
  onShowStatistics,
  onExport,
  onOpenInSipLadder,
  packetColors = new Map(),
  totalPacketCount = null,
  windowStart = 0,
  onRequestWindow,
  windowSize = 20_000,
}: PacketListViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const windowRequestRef = useRef<"none" | "prev" | "next">("none");
  const [columnConfigs, setColumnConfigs] = useState<Record<ColumnId, ColumnConfig>>(
    () => loadColumnConfigs(),
  );
  const [resizingColumn, setResizingColumn] = useState<ColumnId | null>(null);
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(
    () => loadColumnOrder(),
  );
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const draggedColumnRef = useRef<ColumnId | null>(null);
  const dragOverColumnRef = useRef<ColumnId | null>(null);
  const packetListRootRef = useRef<HTMLDivElement | null>(null);
  const [resizeGuideLeft, setResizeGuideLeft] = useState<number | null>(null);
  const headerGridRef = useRef<HTMLDivElement | null>(null);
  const headerCellRefs = useRef<Partial<Record<ColumnId, HTMLDivElement | null>>>({});
  const previousHeaderPositionsRef = useRef<Partial<Record<ColumnId, DOMRect>>>({});

  useEffect(() => { saveColumnConfigs(columnConfigs); }, [columnConfigs]);
  useEffect(() => { saveColumnOrder(columnOrder); }, [columnOrder]);

  // Ensure frameNumber is always in the order if visible
  useEffect(() => {
    if (columnConfigs.frameNumber.visible && !columnOrder.includes("frameNumber")) {
      setColumnOrder(prev => ["frameNumber", ...prev]);
    }
  }, [columnConfigs.frameNumber.visible, columnOrder]);


  // Get visible columns in order
  const visibleColumns = useMemo(
    () => getVisibleColumns(columnConfigs, columnOrder),
    [columnConfigs, columnOrder],
  );

  const packetRows = useMemo<PacketTableRow[]>(
    () => packets.map((packet, originalIndex) => ({ packet, originalIndex })),
    [packets],
  );
  const tableColumns = useMemo<ColumnDef<PacketTableRow, unknown>[]>(() => [
    {
      id: "time",
      accessorFn: (row) => new Date(row.packet.timestamp).getTime(),
    },
    {
      id: "source",
      accessorFn: (row) => row.packet.srcIp,
      sortingFn: ipSortingFn,
    },
    {
      id: "destination",
      accessorFn: (row) => row.packet.dstIp,
      sortingFn: ipSortingFn,
    },
    {
      id: "protocol",
      accessorFn: (row) => row.packet.protocol,
    },
    {
      id: "length",
      accessorFn: (row) => row.packet.size,
    },
    {
      id: "srcMac",
      accessorFn: (row) => row.packet.decoded?.ethernet?.srcMac || "",
    },
    {
      id: "dstMac",
      accessorFn: (row) => row.packet.decoded?.ethernet?.dstMac || "",
    },
    {
      id: "ttl",
      accessorFn: (row) => row.packet.decoded?.ip?.ttl || 0,
    },
    {
      id: "tcpSeq",
      accessorFn: (row) => row.packet.decoded?.tcp?.sequence || 0,
    },
    {
      id: "tcpAck",
      accessorFn: (row) => row.packet.decoded?.tcp?.acknowledgment || 0,
    },
    {
      id: "udpLength",
      accessorFn: (row) => row.packet.decoded?.udp?.length || 0,
    },
    {
      id: "frameNumber",
      accessorFn: (row) => row.originalIndex,
    },
  ], []);
  const { table } = useUnifiedTable<PacketTableRow>({
    data: packetRows,
    columns: tableColumns,
    initialSorting: [{ id: "time", desc: false }],
    getRowId: (row) => String(row.originalIndex),
  });
  const sortedPackets = table.getRowModel().rows.map((row) => row.original);
  const sorting = table.getState().sorting;
  const sortColumn = (sorting[0]?.id as SortColumn) ?? null;
  const sortDirection: SortDirection = sorting.length
    ? (sorting[0]?.desc ? "desc" : "asc")
    : null;

  // Update selectedPacketIndex to match sorted array
  const sortedSelectedIndex = useMemo(() => {
    if (selectedPacketIndex === null || !sortColumn) return selectedPacketIndex;
    return sortedPackets.findIndex(item => item.originalIndex === selectedPacketIndex);
  }, [sortedPackets, selectedPacketIndex, sortColumn]);

  const ROW_HEIGHT = 36;
  const virtualizer = useVirtualizer({
    count: sortedPackets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // Smooth scrolling without excessive render (ahead/behind)
  });

  // Track previous packet count to detect new packets
  const prevPacketCountRef = useRef(sortedPackets.length);
  
  // Auto-scroll to bottom when new packets arrive (when sort is time asc and auto-scroll is enabled)
  useEffect(() => {
    if (!autoScroll || !parentRef.current) return;
    if (sortColumn !== "time" || sortDirection !== "asc") return;
    
    const currentCount = sortedPackets.length;
    const prevCount = prevPacketCountRef.current;
    
    // Only auto-scroll if new packets were added (count increased)
    if (currentCount > prevCount && currentCount > 0) {
      // Check if user is near the bottom (within 2 items) before auto-scrolling
      const scrollElement = parentRef.current;
      if (scrollElement) {
        const scrollTop = scrollElement.scrollTop;
        const scrollHeight = scrollElement.scrollHeight;
        const clientHeight = scrollElement.clientHeight;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        
        // Only auto-scroll if already near bottom (within ~100px) or if this is the first load
        if (distanceFromBottom < 100 || prevCount === 0) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            virtualizer.scrollToIndex(currentCount - 1, { align: "end", behavior: "smooth" });
          });
        }
      }
    }
    
    prevPacketCountRef.current = currentCount;
  }, [sortedPackets.length, autoScroll, virtualizer, sortColumn, sortDirection]);

  // Scroll to top when packets array changes significantly (e.g., filter applied)
  const prevPacketsLengthRef = useRef(packets.length);
  useEffect(() => {
    // If packet count decreased significantly (likely a filter was applied), scroll to top
    if (packets.length < prevPacketsLengthRef.current && packets.length > 0 && parentRef.current) {
      setTimeout(() => {
        virtualizer.scrollToIndex(0, { align: "start", behavior: "auto" });
      }, 0);
    }
    prevPacketsLengthRef.current = packets.length;
  }, [packets.length, virtualizer]);

  // Handle column resizing — use refs to avoid re-running the effect on every config change
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
  const columnConfigsRef = useRef(columnConfigs);
  columnConfigsRef.current = columnConfigs;
  const visibleColumnsRef = useRef(visibleColumns);
  visibleColumnsRef.current = visibleColumns;

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

  const handleSort = useCallback((columnId: ColumnId) => {
    startTransition(() => {
      const column = table.getColumn(columnId);
      if (!column) return;
      const direction = column.getIsSorted();
      if (direction === "asc") {
        column.toggleSorting(true);
      } else if (direction === "desc") {
        table.setSorting([]);
      } else {
        column.toggleSorting(false);
      }
    });
  }, [table]);

  const setColumnVisible = (columnId: ColumnId, visible: boolean) => {
    if (columnId === "frameNumber") return;
    setColumnConfigs(prev => ({
      ...prev,
      [columnId]: { ...prev[columnId], visible },
    }));
    setColumnOrder(prev => {
      if (!visible) return prev.filter(id => id !== columnId);
      return prev.includes(columnId) ? prev : [...prev, columnId];
    });
  };

  const resetColumnsToDefaults = () => {
    const { configs, order } = resetPacketColumnsToDefaults();
    setColumnConfigs(configs);
    setColumnOrder(order);
  };

  const moveColumn = (columnId: ColumnId, direction: "left" | "right") => {
    const currentIndex = visibleColumns.findIndex(col => col.id === columnId);
    if (currentIndex === -1) return;
    
    // Don't allow moving frameNumber (it's always first)
    if (columnId === "frameNumber") return;
    
    const newIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 1 || newIndex >= visibleColumns.length) return; // Can't move before frameNumber or beyond end
    
    const current = visibleColumns[currentIndex]?.id;
    const target = visibleColumns[newIndex]?.id;
    if (!current || !target) return;
    setColumnOrder((prev) =>
      reorderVisibleColumns(prev, visibleColumns.map((col) => col.id), current, target),
    );
  };

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

  const handlePointerDragStart = useCallback((columnId: ColumnId) => {
    if (columnId === "frameNumber") return;
    draggedColumnRef.current = columnId;
    dragOverColumnRef.current = null;
    setDraggedColumn(columnId);
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


  // DNS record type names
  const DNS_RECORD_TYPES: Record<number, string> = {
    1: "A",
    2: "NS",
    5: "CNAME",
    6: "SOA",
    12: "PTR",
    15: "MX",
    16: "TXT",
    28: "AAAA",
    33: "SRV",
  };

  // DNS response code names
  const DNS_RESPONSE_CODES: Record<number, string> = {
    0: "NOERROR",
    1: "FORMERR",
    2: "SERVFAIL",
    3: "NXDOMAIN",
    4: "NOTIMP",
    5: "REFUSED",
  };

  const getDnsRecordType = (type: number): string => {
    return DNS_RECORD_TYPES[type] || `TYPE${type}`;
  };

  const getDnsResponseCode = (code: number): string => {
    return DNS_RESPONSE_CODES[code] || `RCODE${code}`;
  };

  // Memoize getPacketInfo to avoid repeated computations
  const getPacketInfo = useCallback((packet: PacketInfo): string => {
    if (packet.decoded?.application) {
      const app = packet.decoded.application;
      if (app.type === "Sip") {
        if (app.data.method) {
          return app.data.method.toUpperCase();
        }
        if (app.data.responseCode) {
          const code = app.data.responseCode;
          const text = (app.data.responseText || "").trim();
          return text ? `${code} ${text}` : `${code}`;
        }
        if (packet.summary) {
          const match = packet.summary.match(/SIP\s+(\d+\s+\w+|\w+)(?=\s|$)/);
          if (match) {
            return (match[1] ?? "").trim();
          }
        }
        return "SIP";
      } else if (app.type === "Rtp" || app.type === "Srtp") {
        const prefix = app.type === "Srtp" ? "SRTP" : "RTP";
        if (app.data.dtmfEvent) {
          return `${prefix} DTMF '${app.data.dtmfEvent.digit}' SSRC:0x${app.data.ssrc.toString(16)}`;
        }
        return `${prefix} PT:${app.data.payloadType} SSRC:0x${app.data.ssrc.toString(16)}`;
      } else if (app.type === "Dns") {
        const dns = app.data as any;
        if (dns.isResponse) {
          // DNS Response
          const responseCode = dns.responseCode ?? 0;
          const codeName = getDnsResponseCode(responseCode);
          
          if (dns.answers && dns.answers.length > 0) {
            // Show first answer with type
            const firstAnswer = dns.answers[0];
            if (!firstAnswer) return `DNS ${codeName}`;
            const recordType = getDnsRecordType(firstAnswer.rtype ?? 0);
            const answerCount = dns.answers.length;
            if (answerCount === 1) {
              return `${codeName} ${firstAnswer.name} → ${firstAnswer.data} (${recordType})`;
            } else {
              return `${codeName} ${firstAnswer.name} → ${firstAnswer.data} (${recordType}, +${answerCount - 1})`;
            }
          } else {
            // Response with no answers (NXDOMAIN, etc.)
            if (dns.queries && dns.queries.length > 0) {
              const firstQuery = dns.queries[0];
              const queryName = firstQuery?.name ?? "";
              return `${codeName} ${queryName}`;
            }
            return `DNS ${codeName}`;
          }
        } else {
          // DNS Query
          if (dns.queries && dns.queries.length > 0) {
            const query = dns.queries[0];
            if (!query) return "DNS Query";
            const recordType = getDnsRecordType(query.qtype ?? 0);
            if (dns.queries.length === 1) {
              return `Query ${query.name} (${recordType})`;
            } else {
              return `Query ${query.name} (${recordType}, +${dns.queries.length - 1})`;
            }
          }
          return "DNS Query";
        }
      } else if (app.type === "T38") {
        const t38 = app.data;
        const ifp = t38.ifpType ?? "UDPTL";
        return `T.38 ${ifp} seq ${t38.seq ?? 0}`;
      }
    }

    if (packet.protocol === "DNS") {
      // Fallback for DNS packets without decoded data
      if (packet.summary) {
        const match = packet.summary.match(/DNS\s+([^\s]+)/);
        if (match) {
          return `DNS ${match[1]}`;
        }
      }
      return "DNS";
    }

    if (packet.protocol === "SIP" && packet.summary) {
      const match = packet.summary.match(/SIP\s+(\d+\s+\w+|\w+)(?=\s|$)/);
      if (match) {
        return (match[1] ?? "").trim();
      }
    }

    if (packet.protocol === "FAX") {
      if (packet.summary) {
        const match = packet.summary.match(/T\.38\s+(\S+)\s+seq\s+(\d+)/);
        if (match) return `T.38 ${match[1]} seq ${match[2]}`;
      }
      return "T.38 UDPTL";
    }
    
    if (packet.protocol === "ICMP" || packet.protocol === "ARP" || packet.protocol === "Other") {
      return `${packet.protocol} ${packet.srcIp} -> ${packet.dstIp}`;
    }
    
    return `${packet.protocol} ${packet.srcIp}:${packet.srcPort} -> ${packet.dstIp}:${packet.dstPort}`;
  }, []);

  // Static sets and maps for better performance (moved outside function to avoid recreation)

  const getInfoColor = useCallback((packet: PacketInfo, info: string): string => {
    // SIP Methods (optimized lookup)
    const sipMethod = info.toUpperCase();
    const methodColor = SIP_METHOD_COLORS[sipMethod];
    if (methodColor) return methodColor;
    if (SIP_OTHER_METHODS.has(sipMethod)) return "text-warning";
    
    // SIP Response Codes (optimized regex check)
    if (/^\d{3}/.test(info)) {
      const code = parseInt(info.substring(0, 3), 10);
      if (code >= 200 && code < 300) return "text-success";
      if (code >= 300 && code < 400) return "text-warning";
      if (code >= 400 && code < 500) return "text-warning";
      if (code >= 500 && code < 600) return "text-destructive";
      if (code >= 100 && code < 200) return "text-info";
    }
    
    // RTP
    if (info.startsWith("RTP")) return "text-success";

    // T.38 / FAX
    if (info.startsWith("T.38")) return "text-warning";
    
    // Protocol-based colors (optimized lookup)
    return getProtocolLabelColor(packet.protocol);
  }, []);

  const getTcpFlags = useCallback((flags?: number): string => {
    if (flags === undefined) return "";
    const flagNames: string[] = [];
    if (flags & 0x01) flagNames.push("FIN");
    if (flags & 0x02) flagNames.push("SYN");
    if (flags & 0x04) flagNames.push("RST");
    if (flags & 0x08) flagNames.push("PSH");
    if (flags & 0x10) flagNames.push("ACK");
    if (flags & 0x20) flagNames.push("URG");
    return flagNames.join(",") || "None";
  }, []);

  // Memoize grid template columns calculation
  const gridTemplateColumns = useMemo(
    () => getGridTemplateColumns(visibleColumns, columnConfigs),
    [visibleColumns, columnConfigs],
  );

  const renderCell = useCallback((packet: PacketInfo, columnId: ColumnId, sortedItem?: { packet: PacketInfo; originalIndex: number }) => {
    const config = columnConfigs[columnId];
    const alignClass = config.align === "right" ? "text-right" : config.align === "center" ? "text-center" : "";

    switch (columnId) {
      case "time":
        return (
          <div className={cn("text-muted-foreground font-mono text-xs", alignClass)}>
            {formatTimestampCompact(packet.timestamp || "")}
          </div>
        );
      case "source":
        return (
          <div className={cn("min-w-0", alignClass)}>
            <IpAddress
              ip={formatIpPortEndpoint(packet.srcIp, packet.srcPort)}
              variant="mono"
              size="sm"
              className="text-xs"
              showIpInfo={false}
              truncate
            />
          </div>
        );
      case "destination":
        return (
          <div className={cn("min-w-0", alignClass)}>
            <IpAddress
              ip={formatIpPortEndpoint(packet.dstIp, packet.dstPort)}
              variant="mono"
              size="sm"
              className="text-xs"
              showIpInfo={false}
              truncate
            />
          </div>
        );
      case "protocol":
        const protocolUpper = packet.protocol.toUpperCase();
        const protocolColor = getProtocolLabelColor(protocolUpper);
        // Special handling for SIP
        if (protocolUpper === "SIP") {
          return (
            <div className={cn("font-mono text-xs font-semibold text-info", alignClass)}>
              {packet.protocol}
            </div>
          );
        }
        return (
          <div className={cn("font-mono text-xs", protocolColor, alignClass)}>
            {packet.protocol}
          </div>
        );
      case "length":
        return (
          <div className={cn("text-muted-foreground font-mono text-xs", alignClass)}>
            {packet.size}B
          </div>
        );
      case "info":
        const infoText = getPacketInfo(packet);
        const infoColor = getInfoColor(packet, infoText);
        return (
          <div className={cn("text-muted-foreground text-xs truncate min-w-0", alignClass)}>
            <span className={cn("font-semibold", infoColor)}>{infoText}</span>
          </div>
        );
      case "srcMac":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.ethernet?.srcMac || "—"}
          </div>
        );
      case "dstMac":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.ethernet?.dstMac || "—"}
          </div>
        );
      case "ttl":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.ip?.ttl ?? "—"}
          </div>
        );
      case "tcpFlags":
        return (
          <div className={cn("font-mono text-2xs text-muted-foreground", alignClass)}>
            {packet.decoded?.tcp ? getTcpFlags(packet.decoded.tcp.flags) : "—"}
          </div>
        );
      case "tcpSeq":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.tcp?.sequence ? `0x${packet.decoded.tcp.sequence.toString(16)}` : "—"}
          </div>
        );
      case "tcpAck":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.tcp?.acknowledgment ? `0x${packet.decoded.tcp.acknowledgment.toString(16)}` : "—"}
          </div>
        );
      case "udpLength":
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {packet.decoded?.udp?.length ?? "—"}
          </div>
        );
      case "frameNumber":
        const frameNum = sortedItem ? sortedItem.originalIndex : -1;
        return (
          <div className={cn("font-mono text-xs text-muted-foreground", alignClass)}>
            {frameNum >= 0 ? frameNum + 1 : "—"}
          </div>
        );
      case "checksum":
        const checksum = packet.decoded?.ip?.checksum || packet.decoded?.tcp?.checksum || packet.decoded?.udp?.checksum;
        return (
          <div className={cn("font-mono text-2xs text-muted-foreground", alignClass)}>
            {checksum ? `0x${checksum.toString(16)}` : "—"}
          </div>
        );
      default:
        return null;
    }
  }, [columnConfigs]);

  const gridStyle = { gridTemplateColumns: gridTemplateColumns };
  const isWindowed = totalPacketCount != null && totalPacketCount > 0 && onRequestWindow != null;
  const windowEnd = windowStart + packets.length;
  const hasPrev = windowStart > 0;
  const hasNext = totalPacketCount != null && windowEnd < totalPacketCount;

  const handleScroll = useCallback(() => {
    if (!isWindowed || !parentRef.current || !onRequestWindow) return;
    const el = parentRef.current;
    const { scrollTop, clientHeight, scrollHeight } = el;
    const nearTop = scrollTop < 120;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 120;
    if (nearTop && hasPrev && windowRequestRef.current !== "prev") {
      windowRequestRef.current = "prev";
      onRequestWindow(Math.max(0, windowStart - windowSize));
      setTimeout(() => { windowRequestRef.current = "none"; }, 800);
    } else if (nearBottom && hasNext && windowRequestRef.current !== "next") {
      windowRequestRef.current = "next";
      onRequestWindow(windowStart + windowSize);
      setTimeout(() => { windowRequestRef.current = "none"; }, 800);
    }
  }, [isWindowed, onRequestWindow, windowStart, windowSize, hasPrev, hasNext]);

  if (sortedPackets.length === 0) {
    return (
      <EmptyState
        variant="inline"
        title="No packets to display"
        description="Start a capture to see packets"
        className="h-full p-6"
      />
    );
  }

  return (
    <div
      ref={packetListRootRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {resizeGuideLeft != null && resizingColumn != null ? (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-[10050] w-px bg-primary/80 shadow-none"
          style={{ left: resizeGuideLeft }}
          aria-hidden
        />
      ) : null}
      {/* Windowed mode: show "Packets X–Y of Z" and load prev/next on scroll */}
      {isWindowed && totalPacketCount != null && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-muted/10 text-xs text-muted-foreground">
          <span className="font-mono">
            Packets {windowStart + 1}–{windowEnd} of {totalPacketCount.toLocaleString()}
          </span>
          <span className="flex gap-1">
            <TooltipWrapper entry={tooltips.captureWindowPrev}>
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => hasPrev && onRequestWindow?.(Math.max(0, windowStart - windowSize))}
                className="px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
              >
                ← Previous
              </button>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureWindowNext}>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => hasNext && onRequestWindow?.(windowStart + windowSize)}
                className="px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
              >
                Next →
              </button>
            </TooltipWrapper>
          </span>
        </div>
      )}
      {/* Column Headers */}
      <div className="surface-subtle sticky top-0 z-10">
        <div
          ref={headerGridRef}
          className={cn(
            "grid gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground relative select-none overflow-visible",
            draggedColumn && "cursor-grabbing",
            resizingColumn && "cursor-col-resize",
          )}
          style={gridStyle}
        >
          {visibleColumns.map((col, index) => {
            const config = columnConfigs[col.id];
            const isSorted = sortColumn === col.id;
            const SortIcon = isSorted 
              ? (sortDirection === "asc" ? ArrowUp : ArrowDown)
              : ArrowUpDown;
            const isFrameNumber = col.id === "frameNumber";
            const canMoveLeft = !isFrameNumber && index > 1; // Can't move before frameNumber
            const canMoveRight = !isFrameNumber && index < visibleColumns.length - 1;
            
            return (
              <div 
                key={col.id} 
                ref={(node) => {
                  headerCellRefs.current[col.id] = node;
                }}
                className={cn(
                  "packet-list__col-head relative flex items-center gap-1 group",
                  !resizingColumn && "transition-smooth",
                  draggedColumn === col.id && "z-20 rounded-sm bg-accent/45 opacity-65 scale-[0.985]",
                  dragOverColumn === col.id && "rounded-sm bg-accent/35",
                )}
                style={{
                  zIndex:
                    draggedColumn === col.id || dragOverColumn === col.id
                      ? 80 + (visibleColumns.length - index)
                      : visibleColumns.length - index,
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
                    aria-label={`Drag ${config.label} column`}
                  >
                    <GripVertical className="h-2.5 w-2.5" />
                  </button>
                )}
                <div className="flex items-center gap-1 flex-1">
                  {config.sortable ? (
                    <button
                      onClick={() => handleSort(col.id)}
                      className={cn(
                        "flex items-center gap-1 hover:text-foreground transition-smooth",
                        isSorted && "text-foreground"
                      )}
                    >
                      {COLUMN_TOOLTIPS[col.id] ? (
                        <TooltipWrapper entry={COLUMN_TOOLTIPS[col.id]!}>
                          <span className="cursor-help">{config.label}</span>
                        </TooltipWrapper>
                      ) : (
                        <span>{config.label}</span>
                      )}
                      <SortIcon className={cn("h-3 w-3", !isSorted && "opacity-30")} />
                    </button>
                  ) : (
                    COLUMN_TOOLTIPS[col.id] ? (
                      <TooltipWrapper entry={COLUMN_TOOLTIPS[col.id]!}>
                        <span className="cursor-help">{config.label}</span>
                      </TooltipWrapper>
                    ) : (
                      <span>{config.label}</span>
                    )
                  )}
                </div>
                {!isFrameNumber && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <TooltipWrapper entry={tooltips.captureColMoveLeft}>
                      <button
                        onClick={() => moveColumn(col.id, "left")}
                        disabled={!canMoveLeft}
                        className={cn(
                          "h-4 w-4 p-0 hover:bg-accent rounded transition-smooth",
                          !canMoveLeft && "opacity-30 cursor-not-allowed"
                        )}
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                    </TooltipWrapper>
                    <TooltipWrapper entry={tooltips.captureColMoveRight}>
                      <button
                        onClick={() => moveColumn(col.id, "right")}
                        disabled={!canMoveRight}
                        className={cn(
                          "h-4 w-4 p-0 hover:bg-accent rounded transition-smooth",
                          !canMoveRight && "opacity-30 cursor-not-allowed"
                        )}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </TooltipWrapper>
                  </div>
                )}
                <PanelResizeHandle
                  as="div"
                  orientation="vertical"
                  density="compact"
                  appearance="minimal"
                  label={`Resize ${config.label} column`}
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
        </div>
        
        {/* Column Settings Button */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => resetColumnsToDefaults()}>
                <RotateCcw className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                Reset to default columns
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {orderedColumns.map((col) => {
                const visibleIndex = visibleColumns.findIndex((v) => v.id === col.id);
                const canMoveLeft = col.visible && col.id !== "frameNumber" && visibleIndex > 1;
                const canMoveRight = col.visible && col.id !== "frameNumber" && visibleIndex >= 1 && visibleIndex < visibleColumns.length - 1;
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
                          disabled={!canMoveLeft}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            moveColumn(col.id, "left");
                          }}
                          aria-label={`Move ${col.label} column left`}
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent disabled:opacity-35"
                          disabled={!canMoveRight}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            moveColumn(col.id, "right");
                          }}
                          aria-label={`Move ${col.label} column right`}
                        >
                          <ChevronRight className="h-3 w-3" />
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

      {/* Virtualized List - scroll container MUST have a definite height so virtualizer can compute visible items */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative" style={{ minHeight: 400 }}>
        <div
          ref={parentRef}
          className="w-full overflow-y-scroll overflow-x-hidden flex-1"
          style={{ minHeight: 400 }}
          onScroll={isWindowed ? handleScroll : undefined}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const sortedItem = sortedPackets[virtualRow.index];
            if (sortedItem === undefined) return null;
            const isSelected = sortedSelectedIndex === virtualRow.index;
            return (
              <PacketListRow
                key={virtualRow.key}
                sortedItem={sortedItem}
                isSelected={isSelected}
                gridTemplateColumns={gridTemplateColumns}
                packetColors={packetColors}
                onSelectPacket={onSelectPacket}
                visibleColumns={visibleColumns}
                renderCell={renderCell}
                onApplyFilter={onApplyFilter}
                onPrepareFilter={onPrepareFilter}
                onCopy={onCopy}
                onFollowStream={onFollowStream}
                onFollowConversation={onFollowConversation}
                onColorize={onColorize}
                onShowStatistics={onShowStatistics}
                onExport={onExport}
                onOpenInSipLadder={onOpenInSipLadder}
                rowStyle={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${ROW_HEIGHT}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  willChange: "transform",
                }}
              />
            );
          })}
          </div>
        </div>
        <ScrollFloatingButtons scrollRef={parentRef} />
      </div>
    </div>
  );
}

export const PacketListView = React.memo(PacketListViewInner);
export default PacketListView;
