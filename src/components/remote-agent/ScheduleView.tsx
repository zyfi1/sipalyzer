import { useState } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Check, Info, Play } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { id: "monday", label: "Monday", short: "Mon" },
  { id: "tuesday", label: "Tuesday", short: "Tue" },
  { id: "wednesday", label: "Wednesday", short: "Wed" },
  { id: "thursday", label: "Thursday", short: "Thu" },
  { id: "friday", label: "Friday", short: "Fri" },
  { id: "saturday", label: "Saturday", short: "Sat" },
  { id: "sunday", label: "Sunday", short: "Sun" },
];

interface AgentSchedule {
  enabled: boolean;
  days: string[];
  startTime: string;
  endTime: string;
}

export function ScheduleView() {
  const { connections, sendCommand } = useRemoteAgentStore();

  // Local schedule state per agent (keyed by agent ID)
  const [schedules, setSchedules] = useState<Record<string, AgentSchedule>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const getSchedule = (agentId: string): AgentSchedule => {
    return schedules[agentId] ?? {
      enabled: false,
      days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      startTime: "09:00",
      endTime: "17:00",
    };
  };

  const updateSchedule = (agentId: string, update: Partial<AgentSchedule>) => {
    setSchedules((prev) => ({
      ...prev,
      [agentId]: { ...getSchedule(agentId), ...update },
    }));
  };

  const toggleDay = (agentId: string, dayId: string) => {
    const sched = getSchedule(agentId);
    const days = sched.days.includes(dayId)
      ? sched.days.filter((d) => d !== dayId)
      : [...sched.days, dayId];
    updateSchedule(agentId, { days });
  };

  const pushSchedule = async (agentId: string) => {
    const sched = getSchedule(agentId);
    setSaving(agentId);
    try {
      const entries = sched.enabled
        ? [{
            command: "Window",
            params: { days: sched.days, start_time: sched.startTime, end_time: sched.endTime },
            interval_ms: 60_000,
            enabled: true,
          }]
        : [];
      await sendCommand(agentId, "UpdateSchedule", { entries });
      setSaved(agentId);
      setTimeout(() => setSaved(null), 2000);
    } catch {
      // handled by store
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-sm font-medium mb-1">Agent Scheduling</h3>
            <p className="text-xs text-muted-foreground">
              Control when each connected agent is allowed to be active.
              Schedules are pushed live to the agent over the connection.
            </p>
          </div>
          <TooltipWrapper
            title="How Scheduling Works"
            description="When a schedule is enabled, the agent will only stay connected during the allowed time windows. Outside those windows, it disconnects and shows 'Waiting for schedule' in its tray icon. The agent reconnects automatically when the next window starts."
            side="left"
          >
            <span className="inline-flex mt-0.5">
              <Info className="h-4 w-4 text-muted-foreground/60 hover:text-muted-foreground/70 transition-smooth cursor-help" />
            </span>
          </TooltipWrapper>
        </div>

        {/* Empty state */}
        {connections.length === 0 ? (
          <EmptyState variant="inline" title="No agents connected" description="Connect agents to manage their schedules here." />
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map((agent) => {
              const sched = getSchedule(agent.id);
              const isSaving = saving === agent.id;
              const isSaved = saved === agent.id;

              return (
                <div
                  key={agent.id}
                  className="p-4 rounded-md surface flex flex-col gap-3"
                >
                  {/* Agent header */}
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-success status-online shrink-0" />
                    <span className="text-sm font-medium">{agent.hostname}</span>
                    <Badge variant="secondary" className="text-2xs px-1.5 py-0 h-4 font-mono">
                      {agent.os}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{agent.ip}</span>

                    <div className="ml-auto flex items-center gap-2">
                      {/* Schedule toggle */}
                      <button
                        onClick={() => updateSchedule(agent.id, { enabled: !sched.enabled })}
                        className={cn(
                          "relative w-9 h-5 rounded-full transition-smooth",
                          sched.enabled ? "bg-primary" : "bg-muted/50"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 w-4 h-4 rounded-full bg-foreground shadow transition-transform",
                          sched.enabled ? "translate-x-4" : "translate-x-0.5"
                        )} />
                      </button>
                      <span className="text-2xs text-muted-foreground font-medium w-8">
                        {sched.enabled ? "On" : "Off"}
                      </span>
                    </div>
                  </div>

                  {/* Schedule editor (shown when enabled) */}
                  {sched.enabled && (
                    <div className="flex flex-col gap-3 pl-5 border-l-2 border-primary/20 ml-1">
                      {/* Day picker */}
                      <div className="flex items-center gap-1.5">
                        {WEEKDAYS.map((day) => (
                          <button
                            key={day.id}
                            onClick={() => toggleDay(agent.id, day.id)}
                            className={cn(
                              "w-10 h-7 rounded text-2xs font-medium transition-smooth",
                              sched.days.includes(day.id)
                                ? "bg-primary/20 text-primary border border-primary/40"
                                : "bg-muted/20 text-muted-foreground/60 border border-border/20 hover:border-border/40"
                            )}
                          >
                            {day.short}
                          </button>
                        ))}
                      </div>

                      {/* Time range */}
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-muted-foreground w-10 shrink-0">From</span>
                        <Input
                          type="time"
                          value={sched.startTime}
                          onChange={(e) => updateSchedule(agent.id, { startTime: e.target.value })}
                          className="w-28 h-7 text-xs font-mono"
                        />
                        <span className="text-2xs text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={sched.endTime}
                          onChange={(e) => updateSchedule(agent.id, { endTime: e.target.value })}
                          className="w-28 h-7 text-xs font-mono"
                        />
                        <TooltipWrapper
                          title="Time Window"
                          description="The agent will only be active between these hours on the selected days. Times are in the agent's local timezone."
                          side="right"
                        >
                          <span className="inline-flex">
                            <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground/70 transition-smooth cursor-help" />
                          </span>
                        </TooltipWrapper>
                      </div>

                      {/* Quick presets */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-2xs text-muted-foreground mr-1">Quick:</span>
                        {[
                          { label: "Business hours", days: ["monday","tuesday","wednesday","thursday","friday"], start: "09:00", end: "17:00" },
                          { label: "24/7 weekdays", days: ["monday","tuesday","wednesday","thursday","friday"], start: "00:00", end: "23:59" },
                          { label: "All week", days: ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"], start: "00:00", end: "23:59" },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            onClick={() => updateSchedule(agent.id, {
                              days: preset.days,
                              startTime: preset.start,
                              endTime: preset.end,
                            })}
                            className="px-2 py-1 rounded text-2xs font-medium bg-muted/20 text-muted-foreground hover:bg-muted/40 border border-border/20 transition-smooth"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Push button */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="neutral"
                      onClick={() => pushSchedule(agent.id)}
                      disabled={isSaving}
                      className="gap-1.5 text-xs"
                    >
                      {isSaving ? (
                        <>
                          <Spinner className="h-3 w-3 text-primary" />
                          Pushing...
                        </>
                      ) : isSaved ? (
                        <>
                          <Check className="h-3 w-3 text-success" />
                          Saved
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3" />
                          Push to agent
                        </>
                      )}
                    </Button>
                    <span className="text-2xs text-muted-foreground/60">
                      {sched.enabled
                        ? `${sched.days.length} days, ${sched.startTime}–${sched.endTime}`
                        : "No schedule — agent stays connected 24/7"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
