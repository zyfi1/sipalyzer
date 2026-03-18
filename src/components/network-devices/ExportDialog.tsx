import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText, Code } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { saveExportFile, textToBase64 } from "@/api/packetCapture";
import { buildHtmlTableReport } from "@/lib/exportHtml";
import type { DiscoveredDevice } from "@/types/networkDevices";

type ExportFormat = "csv" | "json" | "html";
type ColumnKey =
  | "ip"
  | "mac_address"
  | "oui_vendor"
  | "hostname"
  | "discovery_method"
  | "open_ports"
  | "port"
  | "transport"
  | "status_code"
  | "user_agent"
  | "server"
  | "allow"
  | "contact"
  | "rtt_ms"
  | "vendor"
  | "model"
  | "firmware"
  | "device_type";

interface ExportColumn {
  key: ColumnKey;
  label: string;
  advanced?: boolean;
  align?: "left" | "right" | "center";
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "ip", label: "IP" },
  { key: "hostname", label: "Hostname" },
  { key: "discovery_method", label: "Discovery Method" },
  { key: "open_ports", label: "Open Ports" },
  { key: "transport", label: "Transport" },
  { key: "status_code", label: "Status Code", align: "right" },
  { key: "user_agent", label: "User-Agent" },
  { key: "rtt_ms", label: "RTT (ms)", align: "right" },
  { key: "vendor", label: "Vendor" },
  { key: "model", label: "Model" },
  { key: "firmware", label: "Firmware" },
  { key: "device_type", label: "Device Type" },
  // Advanced / hidden-by-default fields
  { key: "mac_address", label: "MAC Address", advanced: true },
  { key: "oui_vendor", label: "OUI Vendor", advanced: true },
  { key: "port", label: "Port", advanced: true, align: "right" },
  { key: "server", label: "Server", advanced: true },
  { key: "allow", label: "Allow", advanced: true },
  { key: "contact", label: "Contact", advanced: true },
];

const DEFAULT_COLUMN_KEYS: ColumnKey[] = EXPORT_COLUMNS
  .filter((c) => !c.advanced)
  .map((c) => c.key);

interface ExportDialogProps {
  devices: DiscoveredDevice[];
  onClose: () => void;
}

export function ExportDialog({ devices, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [onlyPopulated, setOnlyPopulated] = useState(true);
  const [columnSelection, setColumnSelection] = useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(
      EXPORT_COLUMNS.map((c) => [c.key, DEFAULT_COLUMN_KEYS.includes(c.key)]),
    ) as Record<ColumnKey, boolean>,
  );
  const resetDefaults = () => {
    setOnlyPopulated(true);
    setColumnSelection(
      Object.fromEntries(
        EXPORT_COLUMNS.map((c) => [c.key, DEFAULT_COLUMN_KEYS.includes(c.key)]),
      ) as Record<ColumnKey, boolean>,
    );
  };

  const exportRows = useMemo(
    () =>
      devices.map((d) => ({
        ip: d.ip,
        mac_address: d.mac_address ?? "",
        oui_vendor: d.oui_vendor ?? "",
        hostname: d.hostname ?? "",
        discovery_method: d.discovery_method,
        open_ports: d.open_ports.map((p) => `${p.port}/${p.service_name}`).join("; "),
        port: d.port || "",
        transport: d.transport || "",
        status_code: d.status_code || "",
        user_agent: d.user_agent || "",
        server: d.server_header || "",
        allow: d.allow_header || "",
        contact: d.contact_header || "",
        rtt_ms: d.rtt_ms != null ? d.rtt_ms.toFixed(2) : "",
        vendor: d.fingerprint.vendor || d.oui_vendor || "",
        model: d.fingerprint.model || "",
        firmware: d.fingerprint.firmware || "",
        device_type: d.fingerprint.device_type,
      })),
    [devices],
  );

  const columnsWithData = useMemo(
    () =>
      EXPORT_COLUMNS.filter((column) =>
        exportRows.some((row) => String(row[column.key] ?? "").trim() !== ""),
      ),
    [exportRows],
  );
  const selectedColumns = useMemo(() => {
    if (onlyPopulated) return columnsWithData;
    return EXPORT_COLUMNS.filter((c) => columnSelection[c.key]);
  }, [columnSelection, onlyPopulated, columnsWithData]);
  const hasDataByColumn = useMemo(
    () =>
      Object.fromEntries(
        EXPORT_COLUMNS.map((column) => [
          column.key,
          exportRows.some((row) => String(row[column.key] ?? "").trim() !== ""),
        ]),
      ) as Record<ColumnKey, boolean>,
    [exportRows],
  );
  const skippedForNoDataCount = useMemo(() => {
    if (!onlyPopulated) return 0;
    return EXPORT_COLUMNS.filter(
      (column) => columnSelection[column.key] && !hasDataByColumn[column.key],
    ).length;
  }, [onlyPopulated, columnSelection, hasDataByColumn]);
  const columnsForDisplay = useMemo(
    () => (onlyPopulated ? columnsWithData : EXPORT_COLUMNS),
    [onlyPopulated, columnsWithData],
  );
  const visibleCheckedCount = useMemo(
    () => columnsForDisplay.filter((c) => columnSelection[c.key]).length,
    [columnsForDisplay, columnSelection],
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");

      if (format === "json") {
        const jsonKeyByColumn: Record<ColumnKey, string> = {
          ip: "ip",
          mac_address: "mac_address",
          oui_vendor: "oui_vendor",
          hostname: "hostname",
          discovery_method: "discovery_method",
          open_ports: "open_ports",
          port: "port",
          transport: "transport",
          status_code: "status_code",
          user_agent: "user_agent",
          server: "server",
          allow: "allow",
          contact: "contact",
          rtt_ms: "rtt_ms",
          vendor: "vendor",
          model: "model",
          firmware: "firmware",
          device_type: "device_type",
        };
        const exportData = exportRows.map((row) => {
          const out: Record<string, unknown> = {};
          selectedColumns.forEach((column) => {
            out[jsonKeyByColumn[column.key]] = row[column.key];
          });
          return out;
        });
        const json = JSON.stringify(exportData, null, 2);
        await saveExportFile(
          `network_devices_${ts}.json`,
          textToBase64(json),
          "JSON files",
          "json",
        );
      } else if (format === "html") {
        const html = buildHtmlTableReport({
          title: "Network Device Scan Export",
          subtitle: `${devices.length.toLocaleString()} discovered device${devices.length === 1 ? "" : "s"}`,
          columns: selectedColumns.map((column) => ({
            key: column.key,
            label: column.label,
            align: column.align,
          })),
          rows: exportRows,
        });
        await saveExportFile(
          `network_devices_${ts}.html`,
          textToBase64(html),
          "HTML files",
          "html",
        );
      } else {
        const headers = selectedColumns.map((c) => c.label);
        const rows = exportRows.map((row) =>
          selectedColumns
            .map((c) => row[c.key])
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(","),
        );
        const csv = [headers.join(","), ...rows].join("\n");
        await saveExportFile(
          `network_devices_${ts}.csv`,
          textToBase64(csv),
          "CSV files",
          "csv",
        );
      }
      onClose();
    } catch {
      // Export cancelled by user
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export Scan Results</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Format</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                  format === "csv"
                    ? "border-primary/50 bg-primary/5 shadow-sm"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className={cn("h-4 w-4", format === "csv" ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", format === "csv" ? "text-foreground" : "text-muted-foreground")}>CSV</span>
                </div>
                <p className="text-2xs text-muted-foreground">Comma-separated values</p>
              </button>
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                  format === "json"
                    ? "border-primary/50 bg-primary/5 shadow-sm"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Code className={cn("h-4 w-4", format === "json" ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", format === "json" ? "text-foreground" : "text-muted-foreground")}>JSON</span>
                </div>
                <p className="text-2xs text-muted-foreground">Structured data format</p>
              </button>
              <button
                type="button"
                onClick={() => setFormat("html")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
                  format === "html"
                    ? "border-primary/50 bg-primary/5 shadow-sm"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className={cn("h-4 w-4", format === "html" ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", format === "html" ? "text-foreground" : "text-muted-foreground")}>HTML</span>
                </div>
                <p className="text-2xs text-muted-foreground">Styled report format</p>
              </button>
            </div>
          </div>

          <div className="surface-subtle rounded-lg">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-smooth"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide" : "Show"} export column options
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 space-y-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={onlyPopulated}
                    onCheckedChange={(v) => setOnlyPopulated(v === true)}
                  />
                  Only include columns that have data
                </label>
                <p className="text-2xs text-muted-foreground">
                  {onlyPopulated
                    ? "Only columns with actual data are shown and exported."
                    : "Choose exactly which columns to export."}
                </p>
                {onlyPopulated ? (
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
                    {columnsForDisplay.map((column) => (
                      <label
                        key={column.key}
                        className={cn(
                          "flex items-center gap-2 text-xs",
                          column.advanced ? "text-muted-foreground" : "text-foreground/90",
                        )}
                      >
                        <Checkbox
                          checked={columnSelection[column.key]}
                          onCheckedChange={(v) =>
                            setColumnSelection((prev) => ({
                              ...prev,
                              [column.key]: v === true,
                            }))
                          }
                        />
                        <span>{column.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-2xs text-muted-foreground">
                  {onlyPopulated ? (
                    <>
                      Columns with data: <span className="tabular-nums">{selectedColumns.length}</span>
                    </>
                  ) : (
                    <>
                      Checked: <span className="tabular-nums">{visibleCheckedCount}</span>
                      {" / "}
                      <span className="tabular-nums">{columnsForDisplay.length}</span>
                      {" · "}
                      Will export: <span className="tabular-nums">{selectedColumns.length}</span>
                    </>
                  )}
                </p>
                {!onlyPopulated && skippedForNoDataCount > 0 && (
                  <p className="text-2xs text-warning">
                    {skippedForNoDataCount} checked column{skippedForNoDataCount === 1 ? "" : "s"} skipped because all rows are empty.
                  </p>
                )}
                {selectedColumns.length === 0 && (
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

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            Exporting
            <Badge variant="secondary" className="text-xs tabular-nums">{devices.length}</Badge>
            device{devices.length !== 1 ? "s" : ""}.
          </p>
        </div>

        <DialogFooter>
          <Button variant="neutral" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || devices.length === 0 || selectedColumns.length === 0}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
