import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText, FileCode, File, Table } from "@/lib/icons";
import { useNotifications } from "@/hooks/useNotifications";
import {
  exportPcap as apiExportPcap,
  loadCaptureSession,
  saveExportFile,
} from "@/api/packetCapture";
import type { PacketInfo } from "@/types/packetCapture";
import { cn } from "@/lib/utils";
import { buildHtmlTableReport } from "@/lib/exportHtml";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function strToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Generate a clean timestamp string for filenames (no colons). */
function fileTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Format a byte count as a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Format card definitions                                             */
/* ------------------------------------------------------------------ */

type ExportFormat = "csv" | "json" | "html" | "pcap";
type PacketColumnKey =
  | "timestamp"
  | "src_ip"
  | "src_port"
  | "dst_ip"
  | "dst_port"
  | "protocol"
  | "size"
  | "summary"
  | "decoded";

interface PacketExportColumn {
  key: PacketColumnKey;
  label: string;
  align?: "left" | "right" | "center";
  advanced?: boolean;
  requiresDecoded?: boolean;
}

type PacketTableRow = Record<PacketColumnKey, string | number>;

interface FormatOption {
  id: ExportFormat;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Rough bytes-per-packet multiplier for size estimates */
  bytesPerPacket: number;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: "csv",
    label: "CSV",
    description: "Spreadsheet-friendly. Opens in Excel, Numbers, or Google Sheets.",
    icon: Table,
    bytesPerPacket: 200,
  },
  {
    id: "json",
    label: "JSON",
    description: "Structured data for scripts, APIs, or custom tooling.",
    icon: FileCode,
    bytesPerPacket: 500,
  },
  {
    id: "html",
    label: "HTML Report",
    description: "Printable web page with a formatted packet table.",
    icon: FileText,
    bytesPerPacket: 1000,
  },
  {
    id: "pcap",
    label: "PCAP",
    description: "Binary capture file. Open directly in Wireshark or tcpdump.",
    icon: File,
    bytesPerPacket: 100,
  },
];

const PACKET_COLUMNS: PacketExportColumn[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "src_ip", label: "Source IP" },
  { key: "src_port", label: "Source Port", align: "right" },
  { key: "dst_ip", label: "Destination IP" },
  { key: "dst_port", label: "Destination Port", align: "right" },
  { key: "protocol", label: "Protocol" },
  { key: "size", label: "Size", align: "right" },
  { key: "summary", label: "Summary" },
  { key: "decoded", label: "Decoded Details", advanced: true, requiresDecoded: true },
];

const DEFAULT_PACKET_COLUMN_KEYS: PacketColumnKey[] = PACKET_COLUMNS
  .filter((c) => !c.advanced)
  .map((c) => c.key);

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Packets currently visible in the monitor (filtered view). */
  packets: PacketInfo[];
  /** Active capture session ID — required for PCAP export and lazy-loading. */
  sessionId: string | null;
}

export function ExportDialog({
  open,
  onOpenChange,
  packets,
  sessionId,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeDecoded, setIncludeDecoded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [onlyPopulatedColumns, setOnlyPopulatedColumns] = useState(true);
  const [columnSelection, setColumnSelection] = useState<Record<PacketColumnKey, boolean>>(
    () =>
      Object.fromEntries(
        PACKET_COLUMNS.map((c) => [c.key, DEFAULT_PACKET_COLUMN_KEYS.includes(c.key)]),
      ) as Record<PacketColumnKey, boolean>,
  );
  const resetDefaults = () => {
    setOnlyPopulatedColumns(true);
    setIncludeDecoded(false);
    setColumnSelection(
      Object.fromEntries(
        PACKET_COLUMNS.map((c) => [c.key, DEFAULT_PACKET_COLUMN_KEYS.includes(c.key)]),
      ) as Record<PacketColumnKey, boolean>,
    );
  };
  const [exporting, setExporting] = useState(false);
  const [loadedPackets, setLoadedPackets] = useState<PacketInfo[] | null>(null);
  const { notify } = useNotifications();

  // Packets to export: prefer whatever was passed (filtered), fall back to lazy-loaded
  const packetsToExport = useMemo(() => {
    if (packets.length > 0) return packets;
    return loadedPackets ?? [];
  }, [packets, loadedPackets]);

  // Reset loaded packets when dialog closes or session changes
  useEffect(() => {
    if (!open) setLoadedPackets(null);
  }, [open]);
  useEffect(() => {
    setLoadedPackets(null);
  }, [sessionId]);

  // Available formats: PCAP only when there's a session
  const availableFormats = useMemo(
    () => FORMAT_OPTIONS.filter((f) => f.id !== "pcap" || sessionId),
    [sessionId],
  );

  // Estimated file size
  const estimatedSize = useMemo(() => {
    const opt = FORMAT_OPTIONS.find((f) => f.id === format);
    return formatBytes(packetsToExport.length * (opt?.bytesPerPacket ?? 200));
  }, [format, packetsToExport.length]);

  const packetCount = packetsToExport.length;

  const toTableRow = (packet: PacketInfo): PacketTableRow => ({
    timestamp: packet.timestamp,
    src_ip: packet.srcIp,
    src_port: packet.srcPort,
    dst_ip: packet.dstIp,
    dst_port: packet.dstPort,
    protocol: packet.protocol,
    size: packet.size,
    summary: packet.summary,
    decoded: includeDecoded && packet.decoded ? JSON.stringify(packet.decoded) : "",
  });

  const isNonEmpty = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === "number") return true;
    return String(value).trim() !== "";
  };

  const columnsWithData = useMemo(() => {
    const rows = packetsToExport.map(toTableRow);
    return PACKET_COLUMNS.filter(
      (column) =>
        (!column.requiresDecoded || includeDecoded) &&
        rows.some((row) => isNonEmpty(row[column.key])),
    );
  }, [packetsToExport, includeDecoded]);

  const getActiveColumns = (list: PacketInfo[]): PacketExportColumn[] => {
    if (onlyPopulatedColumns) {
      const rows = list.map(toTableRow);
      return PACKET_COLUMNS.filter(
        (column) =>
          (!column.requiresDecoded || includeDecoded) &&
          rows.some((row) => isNonEmpty(row[column.key])),
      );
    }
    return PACKET_COLUMNS.filter(
      (column) =>
        columnSelection[column.key] &&
        (!column.requiresDecoded || includeDecoded),
    );
  };

  const checkedColumns = useMemo(
    () =>
      PACKET_COLUMNS.filter(
        (column) =>
          columnSelection[column.key] &&
          (!column.requiresDecoded || includeDecoded),
      ),
    [columnSelection, includeDecoded],
  );
  const includedColumnCount = useMemo(
    () => getActiveColumns(packetsToExport).length,
    [packetsToExport, columnSelection, includeDecoded, onlyPopulatedColumns],
  );
  const hasDataByColumn = useMemo(
    () =>
      Object.fromEntries(
        PACKET_COLUMNS.map((column) => [
          column.key,
          columnsWithData.some((c) => c.key === column.key),
        ]),
      ) as Record<PacketColumnKey, boolean>,
    [columnsWithData],
  );
  const skippedForNoDataCount = useMemo(() => {
    if (!onlyPopulatedColumns) return 0;
    return checkedColumns.filter((column) => !hasDataByColumn[column.key]).length;
  }, [onlyPopulatedColumns, checkedColumns, hasDataByColumn]);
  const columnsForDisplay = useMemo(
    () =>
      onlyPopulatedColumns
        ? columnsWithData
        : PACKET_COLUMNS.filter(
            (column) => !column.requiresDecoded || includeDecoded,
          ),
    [onlyPopulatedColumns, columnsWithData, includeDecoded],
  );
  const visibleCheckedCount = useMemo(
    () => columnsForDisplay.filter((column) => columnSelection[column.key]).length,
    [columnsForDisplay, columnSelection],
  );

  /* ---------------------------------------------------------------- */
  /* Export handler                                                     */
  /* ---------------------------------------------------------------- */

  const handleExport = async () => {
    // Gate: PCAP requires sessionId, text formats require packets (or ability to load them)
    if (format === "pcap" && !sessionId) {
      notify({ type: "error", title: "No session", description: "PCAP export requires an active capture session.", source: "packet-capture" });
      return;
    }
    if (format !== "pcap" && packetCount === 0 && !sessionId) {
      notify({ type: "error", title: "No packets", description: "Nothing to export.", source: "packet-capture" });
      return;
    }

    setExporting(true);
    try {
      if (format === "pcap") {
        const path = await apiExportPcap(sessionId!, null);
        notify({ type: "success", title: "PCAP exported", description: path, source: "packet-capture" });
        onOpenChange(false);
        return;
      }

      // Ensure we have packets — lazy-load from session if needed
      let list = packetsToExport;
      if (list.length === 0 && sessionId) {
        const loaded = await loadCaptureSession(sessionId);
        setLoadedPackets(loaded);
        list = loaded;
      }
      if (list.length === 0) {
        notify({ type: "error", title: "No packets", description: "This capture has no packets to export.", source: "packet-capture" });
        setExporting(false);
        return;
      }

      const ts = fileTimestamp();
      let path: string;
      const activeColumns = getActiveColumns(list);
      if (activeColumns.length === 0) {
        notify({
          type: "error",
          title: "No columns selected",
          description: "Select at least one export column, or disable 'Only include columns that have data'.",
          source: "packet-capture",
        });
        setExporting(false);
        return;
      }
      const tableRows = list.map(toTableRow);

      if (format === "json") {
        const jsonKeyByColumn: Record<PacketColumnKey, string> = {
          timestamp: "timestamp",
          src_ip: "srcIp",
          src_port: "srcPort",
          dst_ip: "dstIp",
          dst_port: "dstPort",
          protocol: "protocol",
          size: "size",
          summary: "summary",
          decoded: "decoded",
        };
        const exportData = list.map((packet) => {
          const row = toTableRow(packet);
          const out: Record<string, unknown> = {};
          activeColumns.forEach((column) => {
            const jsonKey = jsonKeyByColumn[column.key];
            if (column.key === "decoded") {
              if (includeDecoded && packet.decoded) out[jsonKey] = packet.decoded;
              return;
            }
            out[jsonKey] = row[column.key];
          });
          return out;
        });
        const json = JSON.stringify(exportData, null, 2);
        path = await saveExportFile(`packets_${ts}.json`, strToBase64(json), "JSON files", "json");
      } else if (format === "csv") {
        const headers = activeColumns.map((column) => column.label);
        const rows = tableRows.map((row) =>
          activeColumns
            .map((column) => String(row[column.key]))
            .map((c) => `"${c.replace(/"/g, '""')}"`)
            .join(","),
        );
        const csv = [headers.join(","), ...rows].join("\n");
        path = await saveExportFile(`packets_${ts}.csv`, strToBase64(csv), "CSV files", "csv");
      } else {
        // HTML
        const html = buildHtmlTableReport({
          title: "Packet Capture Export",
          subtitle: `${list.length.toLocaleString()} packets`,
          columns: activeColumns.map((column) => ({
            key: column.key,
            label: column.label,
            align: column.align,
          })),
          rows: tableRows,
        });
        path = await saveExportFile(`packets_${ts}.html`, strToBase64(html), "HTML files", "html");
      }

      notify({ type: "success", title: "Exported", description: path, source: "packet-capture" });
      onOpenChange(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      // Don't toast for user-cancelled file dialog
      if (!msg.includes("cancelled")) {
        notify({ type: "error", title: "Export failed", description: msg, source: "packet-capture" });
      }
    } finally {
      setExporting(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Packets</DialogTitle>
          <DialogDescription>
            {packetCount > 0
              ? `${packetCount.toLocaleString()} packets will be exported.`
              : sessionId
                ? "Packets will be loaded from the capture session."
                : "No packets available to export."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Format cards */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Format
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {availableFormats.map((opt) => {
                const selected = format === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFormat(opt.id)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-md border border-border/45 bg-card/50 p-3 text-left transition-smooth",
                      "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary/45 bg-primary/[0.08]"
                        : "hover:border-border/55",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <opt.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          selected
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          selected && "text-primary",
                        )}
                      >
                        {opt.label}
                      </span>
                    </div>
                    <span className="text-2xs leading-snug text-muted-foreground">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Options - only for text-based formats */}
          {format !== "pcap" && (
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Options
              </Label>
              <div className="overflow-hidden rounded-md border border-border/50 bg-card/50">
                <button
                  type="button"
                  className="w-full border-b border-border/40 bg-muted/20 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-smooth hover:text-foreground"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? "Hide" : "Show"} export column options
                </button>
                {showAdvanced && (
                  <div className="px-3 pb-3 space-y-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={onlyPopulatedColumns}
                        onCheckedChange={(v) => setOnlyPopulatedColumns(v === true)}
                      />
                      Only include columns that have data
                    </label>
                    <p className="text-2xs text-muted-foreground">
                      {onlyPopulatedColumns
                        ? "Only columns with actual data are shown and exported."
                        : "Choose exactly which columns to export."}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={includeDecoded}
                        onCheckedChange={(v) => setIncludeDecoded(v === true)}
                      />
                      Include decoded protocol fields (advanced)
                    </label>
                    {onlyPopulatedColumns ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {columnsForDisplay.map((column) => (
                          <div
                            key={column.key}
                            className={cn(
                              "text-xs",
                              column.advanced ? "text-muted-foreground" : "text-foreground/90",
                            )}
                          >
                            {column.label}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {columnsForDisplay.map((column) => {
                          const disabled = column.requiresDecoded && !includeDecoded;
                          return (
                            <label
                              key={column.key}
                              className={cn(
                                "flex items-center gap-2 text-xs",
                                column.advanced ? "text-muted-foreground" : "text-foreground/90",
                                disabled && "opacity-50",
                              )}
                            >
                              <Checkbox
                                checked={columnSelection[column.key]}
                                disabled={disabled}
                                onCheckedChange={(v) =>
                                  setColumnSelection((prev) => ({
                                    ...prev,
                                    [column.key]: v === true,
                                  }))
                                }
                              />
                              <span>{column.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-2xs text-muted-foreground">
                      {onlyPopulatedColumns ? (
                        <>
                          Columns with data: <span className="tabular-nums">{includedColumnCount}</span>
                        </>
                      ) : (
                        <>
                          Checked:{" "}
                          <span className="tabular-nums">{visibleCheckedCount}</span>
                          {" / "}
                          <span className="tabular-nums">{columnsForDisplay.length}</span>
                          {" · "}
                          Will export:{" "}
                          <span className="tabular-nums">{includedColumnCount}</span>
                        </>
                      )}
                    </p>
                    {!onlyPopulatedColumns && skippedForNoDataCount > 0 && (
                      <p className="text-2xs text-warning">
                        {skippedForNoDataCount} checked column{skippedForNoDataCount === 1 ? "" : "s"} skipped because all rows are empty.
                      </p>
                    )}
                    {includedColumnCount === 0 && (
                      <p className="text-2xs text-warning">
                        No columns currently included. Select at least one column or disable "Only include columns that have data".
                      </p>
                    )}
                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        onClick={resetDefaults}
                        className="h-7 px-2 text-2xs"
                      >
                        Reset to defaults
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary bar */}
          <div className="flex items-center justify-between rounded-md border border-border/45 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span>{packetCount.toLocaleString()} packets</span>
            <span>~{estimatedSize}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="neutral"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || (packetCount === 0 && !sessionId) || (format !== "pcap" && includedColumnCount === 0)}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting\u2026" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
