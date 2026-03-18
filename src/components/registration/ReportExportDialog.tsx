import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface ReportExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  registrarIds?: string[];
}

export function ReportExportDialog({ isOpen, onClose, registrarIds }: ReportExportDialogProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const exportTestResults = useRegistrationStore((s) => s.exportTestResults);
  const { success: notifySuccess, error: notifyError } = useNotifications();
  const [format, setFormat] = useState<"html" | "pdf">("html");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedRegistrarIds, setSelectedRegistrarIds] = useState<string[]>(registrarIds || []);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      // For now, export to default location. The Rust command will handle the file path.
      // TODO: Add tauri-plugin-dialog for file picker support
      const result = await exportTestResults(format, selectedRegistrarIds.length > 0 ? selectedRegistrarIds : undefined, null);
      notifySuccess("Export Successful", result, { source: "registration" });
      onClose();
    } catch (error) {
      notifyError("Export Failed", error instanceof Error ? error.message : "Unknown error", { source: "registration" });
    } finally {
      setExporting(false);
    }
  };

  const toggleRegistrar = (id: string) => {
    setSelectedRegistrarIds((prev) =>
      prev.includes(id) ? prev.filter((rId) => rId !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedRegistrarIds(registrars.map((r) => r.id!).filter(Boolean));
  };

  const deselectAll = () => {
    setSelectedRegistrarIds([]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[calc(min(100vh,100dvh)-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Report</DialogTitle>
          <DialogDescription>
            Export registration health and test results in your preferred format
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div className="space-y-2">
            <Label>Export Format</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="html"
                  checked={format === "html"}
                  onChange={(e) => setFormat(e.target.value as "html" | "pdf")}
                  className="rounded border-border"
                />
                <span>HTML</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="pdf"
                  checked={format === "pdf"}
                  onChange={(e) => setFormat(e.target.value as "html" | "pdf")}
                  className="rounded border-border"
                />
                <span>PDF</span>
              </label>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
              />
            </div>
          </div>

          {/* Registrar Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Registrars</Label>
              <div className="flex gap-2">
                <TooltipWrapper title="Select All" description="Include all registrars in the export.">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAll}
                    className="h-7 text-xs"
                  >
                    Select All
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper title="Deselect All" description="Clear registrar selection for export.">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={deselectAll}
                    className="h-7 text-xs"
                  >
                    Deselect All
                  </Button>
                </TooltipWrapper>
              </div>
            </div>
            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {registrars.map((registrar) => (
                <label
                  key={registrar.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedRegistrarIds.includes(registrar.id!)}
                    onChange={() => toggleRegistrar(registrar.id!)}
                    className="rounded border-border"
                  />
                  <span className="text-sm">{registrar.name} ({registrar.domain})</span>
                </label>
              ))}
              {registrars.length === 0 && (
                <EmptyState compact variant="inline" title="No registrars available" />
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <TooltipWrapper title="Cancel" description="Close without exporting.">
            <Button variant="neutral" onClick={onClose} disabled={exporting}>
              Cancel
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Export" description="Generate and save the report in the selected format.">
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting..." : "Export"}
            </Button>
          </TooltipWrapper>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
