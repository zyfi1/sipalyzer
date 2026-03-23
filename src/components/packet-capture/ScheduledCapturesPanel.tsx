import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, 
  Plus, 
  Trash2, 
  Power,
  PowerOff,
  Clock,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Network,
  Wifi,
  Check,
} from "@/lib/icons";
import { useNotifications } from "@/hooks/useNotifications";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ScheduledCapture, FilterConfig } from "@/types/packetCapture";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { HelpCircle } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";

const DURATION_PRESETS = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "custom", label: "Custom" },
] as const;

const scheduleCaptureSchema = z.object({
  name: z.string().trim().min(1, "Please fill in name, interface, and time"),
  interface: z.string().trim().min(1, "Please fill in name, interface, and time"),
  scheduleType: z.enum(["one_time", "recurring"]),
  date: z.string(),
  time: z.string().trim().min(1, "Please fill in name, interface, and time"),
  durationPreset: z.string(),
  customDuration: z.string(),
}).superRefine((value, ctx) => {
  if (value.scheduleType === "one_time" && !value.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["date"],
      message: "Please select a date for one-time capture",
    });
  }
});

type ScheduleCaptureFormValues = z.infer<typeof scheduleCaptureSchema>;

const SCHEDULE_CAPTURE_DEFAULTS: ScheduleCaptureFormValues = {
  name: "",
  interface: "",
  scheduleType: "one_time",
  date: "",
  time: "",
  durationPreset: "300",
  customDuration: "",
};

export function ScheduledCapturesPanel() {
  const scheduledCaptures = usePacketCaptureStore((s) => s.scheduledCaptures);
  const loadingScheduledCaptures = usePacketCaptureStore((s) => s.loadingScheduledCaptures);
  const fetchScheduledCaptures = usePacketCaptureStore((s) => s.fetchScheduledCaptures);
  const createScheduledCapture = usePacketCaptureStore((s) => s.createScheduledCapture);
  const updateScheduledCapture = usePacketCaptureStore((s) => s.updateScheduledCapture);
  const deleteScheduledCapture = usePacketCaptureStore((s) => s.deleteScheduledCapture);
  const interfaces = usePacketCaptureStore((s) => s.interfaces);
  const fetchInterfaces = usePacketCaptureStore((s) => s.fetchInterfaces);
  const { notify } = useNotifications();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  
  const {
    watch,
    setValue,
    getValues,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<ScheduleCaptureFormValues>({
    resolver: zodResolver(scheduleCaptureSchema),
    defaultValues: SCHEDULE_CAPTURE_DEFAULTS,
  });
  const formData = watch();
  const setFormData = (
    next:
      | ScheduleCaptureFormValues
      | ((prev: ScheduleCaptureFormValues) => ScheduleCaptureFormValues)
  ) => {
    const prev = getValues();
    const resolved = typeof next === "function" ? next(prev) : next;
    for (const [key, value] of Object.entries(resolved) as Array<[keyof ScheduleCaptureFormValues, ScheduleCaptureFormValues[keyof ScheduleCaptureFormValues]]>) {
      setValue(key, value, { shouldDirty: true });
    }
  };

  useEffect(() => {
    fetchScheduledCaptures();
    fetchInterfaces();
  }, [fetchScheduledCaptures, fetchInterfaces]);

  // Set default date to today when dialog opens
  useEffect(() => {
    if (createDialogOpen) {
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const timeStr = now.toTimeString().slice(0, 5);
      reset({
        ...SCHEDULE_CAPTURE_DEFAULTS,
        date: dateStr ?? "",
        time: timeStr,
        name: `Scheduled Capture`,
      });
    }
  }, [createDialogOpen, reset]);

  const resetForm = () => {
    reset(SCHEDULE_CAPTURE_DEFAULTS);
  };

  const onInvalidCreate = () => {
    if (errors.date?.message) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Missing Date",
        description: errors.date.message,
      });
      return;
    }

    notify({ source: "packet-capture",
      type: "error",
      title: "Missing Fields",
      description: "Please fill in name, interface, and time",
    });
  };

  const runCreate = async (formData: ScheduleCaptureFormValues) => {
    try {
      const filterConfig: FilterConfig = {
        protocols: [],
        srcIpRanges: [],
        dstIpRanges: [],
        srcPorts: [],
        dstPorts: [],
        portRanges: [],
      };

      // Build scheduled time
      let scheduledTime: string;
      if (formData.scheduleType === "one_time") {
        scheduledTime = `${formData.date}T${formData.time}`;
      } else {
        scheduledTime = formData.time;
      }

      // Get duration
      const durationSeconds = formData.durationPreset === "custom"
        ? (formData.customDuration ? parseInt(formData.customDuration) : undefined)
        : parseInt(formData.durationPreset);

      await createScheduledCapture(
        formData.name,
        null,
        formData.interface,
        filterConfig,
        formData.scheduleType,
        scheduledTime,
        durationSeconds
      );

      notify({ source: "packet-capture",
        type: "success",
        title: "Scheduled",
        description: "Capture has been scheduled",
      });

      setCreateDialogOpen(false);
      resetForm();
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed",
        description: error.message || "Unknown error",
      });
    }
  };
  const handleCreate = handleSubmit(runCreate, onInvalidCreate);

  const handleToggleEnabled = async (capture: ScheduledCapture) => {
    try {
      await updateScheduledCapture(capture.id, { enabled: !capture.enabled });
      notify({ source: "packet-capture",
        type: "success",
        title: capture.enabled ? "Disabled" : "Enabled",
        description: `Scheduled capture ${capture.enabled ? "disabled" : "enabled"}`,
      });
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed",
        description: error.message || "Unknown error",
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduledCapture(id);
      notify({ source: "packet-capture",
        type: "success",
        title: "Deleted",
        description: "Scheduled capture deleted",
      });
      setConfirmDeleteId(null);
    } catch (error: any) {
      notify({ source: "packet-capture",
        type: "error",
        title: "Failed",
        description: error.message || "Unknown error",
      });
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const formatNextRun = (nextRun?: string) => {
    if (!nextRun) return "Not scheduled";
    const date = new Date(nextRun);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMs < 0) return "Overdue";
    if (diffMins < 60) return `In ${diffMins}m`;
    if (diffHours < 24) return `In ${diffHours}h`;
    if (diffDays < 7) return `In ${diffDays}d`;
    return date.toLocaleDateString();
  };

  const formatTime = (nextRun?: string) => {
    if (!nextRun) return "";
    const date = new Date(nextRun);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Group by enabled/disabled
  const enabledCaptures = scheduledCaptures.filter((c) => c.enabled);
  const disabledCaptures = scheduledCaptures.filter((c) => !c.enabled);

  // Get recommended interface
  const recommendedInterface = useMemo(() => {
    if (interfaces.length === 0) return null;
    const candidates = interfaces.filter(i => {
      const isLoopback = i.name.includes("lo") || i.name.includes("Loopback");
      const isVirtual = i.name.includes("veth") || i.name.includes("docker");
      return !isLoopback && !isVirtual && i.addresses.length > 0;
    });
    const primary = candidates.find(i => 
      ["en0", "eth0", "wlan0", "Wi-Fi", "Ethernet"].some(name => 
        i.name.toLowerCase().includes(name.toLowerCase())
      )
    );
    return primary || candidates[0] || interfaces[0];
  }, [interfaces]);

  // Auto-select recommended interface when dialog opens
  useEffect(() => {
    if (createDialogOpen && recommendedInterface && !formData.interface) {
      setFormData((prev) => ({ ...prev, interface: recommendedInterface.name }));
    }
  }, [createDialogOpen, recommendedInterface, formData.interface]);

  if (loadingScheduledCaptures) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        Loading scheduled captures...
      </div>
    );
  }

  return (
    <>
      <div className="h-full min-h-0 app-view-gutter">
        <div className="ui-panel-shell h-full min-h-0 flex flex-col overflow-hidden">
          <div className="flex-none border-b border-border/35 px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="section-label">Scheduled Captures</span>
                {enabledCaptures.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {enabledCaptures.length} active
                  </Badge>
                )}
              </div>
              <TooltipWrapper entry={tooltips.captureScheduleNew}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Schedule
                </Button>
              </TooltipWrapper>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto app-view-stack">
            {scheduledCaptures.length === 0 ? (
              <EmptyState
                variant="inline"
                icon={<Calendar />}
                title="No scheduled captures"
                description="Schedule automatic captures for specific times."
                action={
                  <Button
                    size="sm"
                    variant="neutral"
                    className="h-8 gap-1.5 px-3 text-xs"
                    onClick={() => setCreateDialogOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Schedule Capture
                  </Button>
                }
              />
            ) : (
              <>
                {/* Active Section */}
                {enabledCaptures.length > 0 && (
                  <div>
                    <button
                      onClick={() => toggleSection("active")}
                      className="w-full flex items-center gap-2 px-4 py-2.5 section-label bg-muted/15 hover:bg-muted/15 transition-smooth"
                    >
                      {collapsedSections.has("active") ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span>Active</span>
                      <span className="opacity-60">({enabledCaptures.length})</span>
                    </button>
                    {!collapsedSections.has("active") && (
                      <div className="divide-y divide-border/30">
                        {enabledCaptures.map((capture) => (
                          <CaptureRow
                            key={capture.id}
                            capture={capture}
                            formatNextRun={formatNextRun}
                            formatTime={formatTime}
                            onToggle={() => handleToggleEnabled(capture)}
                            onDelete={() => setConfirmDeleteId(capture.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Disabled Section */}
                {disabledCaptures.length > 0 && (
                  <div>
                    <button
                      onClick={() => toggleSection("disabled")}
                      className="w-full flex items-center gap-2 px-4 py-2.5 section-label bg-muted/15 hover:bg-muted/15 transition-smooth"
                    >
                      {collapsedSections.has("disabled") ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span>Disabled</span>
                      <span className="opacity-60">({disabledCaptures.length})</span>
                    </button>
                    {!collapsedSections.has("disabled") && (
                      <div className="divide-y divide-border/30">
                        {disabledCaptures.map((capture) => (
                          <CaptureRow
                            key={capture.id}
                            capture={capture}
                            formatNextRun={formatNextRun}
                            formatTime={formatTime}
                            onToggle={() => handleToggleEnabled(capture)}
                            onDelete={() => setConfirmDeleteId(capture.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create Dialog - Improved */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Schedule Capture
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Capture Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Morning Traffic Analysis"
                className="h-10"
              />
            </div>

            {/* Interface Selection */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium">
                  Network Interface <span className="text-destructive">*</span>
                </Label>
                <TooltipWrapper entry={tooltips.statInterface}>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto rounded-md border border-border/40 p-2 bg-muted/10">
                {interfaces.length === 0 ? (
                  <EmptyState compact variant="inline" title="No interfaces available" />
                ) : (
                  interfaces.map((iface) => {
                    const isSelected = formData.interface === iface.name;
                    const isRecommended = iface.name === recommendedInterface?.name;
                    return (
                      <button
                        key={iface.name}
                        type="button"
                        onClick={() => setFormData({ ...formData, interface: iface.name })}
                        className={cn(
                          "flex items-center gap-3 p-2.5 rounded-md text-left transition-smooth",
                          isSelected
                            ? "bg-accent border border-foreground/30"
                            : "hover:bg-muted/50 border border-transparent"
                        )}
                      >
                        <div className={cn(
                          "flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                          isSelected ? "bg-muted/40" : "bg-muted"
                        )}>
                          {iface.name.toLowerCase().includes("wi") || iface.name.toLowerCase().includes("wlan") ? (
                            <Wifi className={cn("h-4 w-4", isSelected ? "text-foreground" : "text-muted-foreground")} />
                          ) : (
                            <Network className={cn("h-4 w-4", isSelected ? "text-foreground" : "text-muted-foreground")} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{iface.name}</span>
                            {isRecommended && (
                              <Badge variant="secondary" className="text-2xs h-4">Recommended</Badge>
                            )}
                          </div>
                          {iface.description && (
                            <div className="text-xs text-muted-foreground truncate">{iface.description}</div>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-foreground flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Schedule Type */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium">Schedule Type</Label>
                <TooltipWrapper entry={tooltips.captureScheduleOneTime}>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, scheduleType: "one_time" })}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-smooth",
                    formData.scheduleType === "one_time"
                      ? "border-foreground/30 bg-muted/20"
                      : "border-border hover:border-muted-foreground/50"
                  )}
                >
                  <Calendar className={cn(
                    "h-6 w-6",
                    formData.scheduleType === "one_time" ? "text-foreground" : "text-muted-foreground"
                  )} />
                  <div className="text-center">
                    <div className="text-sm font-medium">One-time</div>
                    <div className="text-xs text-muted-foreground">Run once at specific date/time</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, scheduleType: "recurring" })}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-md border-2 transition-smooth",
                    formData.scheduleType === "recurring"
                      ? "border-foreground/30 bg-muted/20"
                      : "border-border hover:border-muted-foreground/50"
                  )}
                >
                  <RefreshCw className={cn(
                    "h-6 w-6",
                    formData.scheduleType === "recurring" ? "text-foreground" : "text-muted-foreground"
                  )} />
                  <div className="text-center">
                    <div className="text-sm font-medium">Daily</div>
                    <div className="text-xs text-muted-foreground">Run every day at same time</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Date & Time */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">
                {formData.scheduleType === "one_time" ? "Date & Time" : "Time"} <span className="text-destructive">*</span>
              </Label>
              <div className={cn(
                "grid gap-3",
                formData.scheduleType === "one_time" ? "grid-cols-2" : "grid-cols-1"
              )}>
                {formData.scheduleType === "one_time" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      min={new Date().toISOString().split("T")[0]}
                      className="h-10"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Time</Label>
                  <Input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="h-10"
                  />
                </div>
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium">Capture Duration</Label>
                <TooltipWrapper entry={tooltips.filterDuration}>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, durationPreset: preset.value })}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium transition-smooth",
                      formData.durationPreset === preset.value
                        ? "bg-accent text-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {formData.durationPreset === "custom" && (
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    value={formData.customDuration}
                    onChange={(e) => setFormData({ ...formData, customDuration: e.target.value })}
                    placeholder="Duration"
                    className="h-9 w-32"
                  />
                  <span className="text-sm text-muted-foreground">seconds</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <TooltipWrapper entry={tooltips.captureFilterCancel}>
              <Button variant="ghost" onClick={() => { setCreateDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
            </TooltipWrapper>
            <TooltipWrapper entry={tooltips.captureScheduleNew}>
              <Button onClick={() => void handleCreate()} className="gap-2">
                <Calendar className="h-4 w-4" />
                Schedule Capture
              </Button>
            </TooltipWrapper>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <ConfirmDialog
          open={!!confirmDeleteId}
          onOpenChange={(open) => !open && setConfirmDeleteId(null)}
          title="Delete Scheduled Capture"
          description="Are you sure you want to delete this scheduled capture? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          variant="destructive"
          onConfirm={() => handleDelete(confirmDeleteId)}
        />
      )}
    </>
  );
}

// Extracted row component
function CaptureRow({
  capture,
  formatNextRun,
  formatTime,
  onToggle,
  onDelete,
}: {
  capture: ScheduledCapture;
  formatNextRun: (nextRun?: string) => string;
  formatTime: (nextRun?: string) => string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn(
      "group flex items-center gap-3 px-4 py-3 transition-smooth",
      capture.enabled ? "hover:bg-muted/30" : "opacity-60 hover:bg-muted/20"
    )}>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{capture.name}</span>
          <Badge 
            variant={capture.scheduleType === "recurring" ? "secondary" : "secondary"} 
            className="text-2xs h-4 px-1.5"
          >
            {capture.scheduleType === "recurring" ? "Daily" : "Once"}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {capture.nextRun ? formatTime(capture.nextRun) : "—"}
          </span>
          <TooltipWrapper entry={tooltips.captureScheduleOneTime}>
            <span className="cursor-help">{formatNextRun(capture.nextRun)}</span>
          </TooltipWrapper>
          {capture.durationSeconds && (
            <TooltipWrapper entry={tooltips.filterDuration}>
              <span className="cursor-help">{capture.durationSeconds}s duration</span>
            </TooltipWrapper>
          )}
        </div>
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <TooltipWrapper entry={tooltips.captureScheduleToggle(capture.enabled)}>
          <Button
            size="sm"
            variant={capture.enabled ? "outline" : "default"}
            className="h-7 text-xs gap-1.5"
            onClick={onToggle}
          >
            {capture.enabled ? (
              <>
                <PowerOff className="h-3.5 w-3.5" />
                Disable
              </>
            ) : (
              <>
                <Power className="h-3.5 w-3.5" />
                Enable
              </>
            )}
          </Button>
        </TooltipWrapper>
        <TooltipWrapper entry={tooltips.captureScheduleDelete}>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 w-7 p-0"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
      </div>
    </div>
  );
}
