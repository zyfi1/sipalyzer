import { useEffect, useMemo, useState } from "react";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import {
  useExecutionContextStore,
  type ExecutionContext,
} from "@/stores/executionContextStore";
import { navigateTo } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Desktop,
  ChevronDown,
  Check,
  Globe,
  Search,
  Satellite,
  WindowsLogo,
  AppleLogo,
  LinuxLogo,
  Clock,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { AgentConnection } from "@/api/remoteAgent";

function osIcon(os: string) {
  const l = os.toLowerCase();
  if (l.includes("windows")) return WindowsLogo;
  if (l.includes("mac") || l.includes("darwin")) return AppleLogo;
  if (l.includes("linux")) return LinuxLogo;
  return Satellite;
}

function osToneClass(os: string): string {
  const l = os.toLowerCase();
  if (l.includes("windows")) return "ui-choice-tone-info";
  if (l.includes("linux")) return "ui-choice-tone-warning";
  return "ui-choice-tone-primary";
}

function latencyColor(ms: number | null): string {
  if (ms == null) return "text-muted-foreground/60";
  if (ms < 80) return "text-success";
  if (ms < 200) return "text-warning";
  return "text-destructive";
}

function formatUptime(secs: number): string {
  if (secs <= 0) return "";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  const d = Math.floor(secs / 86400);
  return `${d}d`;
}

interface ExecutionContextSelectorProps {
  toolId?: string;
  value?: ExecutionContext;
  onChange?: (ctx: ExecutionContext) => void;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "header";
}

export function ExecutionContextSelector({
  toolId,
  value,
  onChange,
  disabled,
  className,
  variant = "default",
}: ExecutionContextSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"local" | "remote">("local");
  const allConnections = useRemoteAgentStore((s) => s.connections);
  const {
    context: globalCtx,
    toolOverrides,
    setContext,
    setToolOverride,
    clearToolOverride,
    resolvedContext,
    resolvedAgentName,
  } = useExecutionContextStore();

  const connectedAgents = useMemo(
    () => allConnections.filter((c) => c.status === "connected"),
    [allConnections],
  );

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return connectedAgents;
    const q = search.toLowerCase();
    return connectedAgents.filter(
      (a) =>
        (a.name ?? "").toLowerCase().includes(q) ||
        a.hostname.toLowerCase().includes(q) ||
        a.ip.toLowerCase().includes(q) ||
        a.os.toLowerCase().includes(q),
    );
  }, [connectedAgents, search]);


  const isControlled = value !== undefined;
  const resolved = isControlled ? value : resolvedContext(toolId ?? "__global__");
  const isRemote = resolved.type === "remote";

  const resolvedAgent: AgentConnection | undefined = isRemote
    ? connectedAgents.find((c) => c.id === (resolved as { agentId: string }).agentId)
    : undefined;

  const agentName = isControlled
    ? (resolved.type === "remote"
        ? (resolvedAgent?.name ||
           resolvedAgent?.hostname ||
           (resolved as { agentId: string }).agentId.slice(0, 8))
        : null)
    : resolvedAgentName(toolId ?? "__global__");

  const hasOverride = !isControlled && toolId ? toolId in toolOverrides : false;

  const globalContextLabel = (() => {
    if (globalCtx.type === "local") return "Local";
    const ga = connectedAgents.find((c) => c.id === (globalCtx as { agentId: string }).agentId);
    return ga?.name || ga?.hostname || "Remote";
  })();

  const applyContext = (ctx: ExecutionContext) => {
    if (isControlled) {
      onChange?.(ctx);
    } else if (toolId) {
      if (ctx.type === "local" && globalCtx.type === "local") {
        clearToolOverride(toolId);
      } else {
        setToolOverride(toolId, ctx);
      }
    } else {
      setContext(ctx);
    }
  };

  const select = async (ctx: ExecutionContext) => {
    applyContext(ctx);
    setOpen(false);
    setSearch("");
  };

  const isActive = (ctx: ExecutionContext) => {
    if (resolved.type === "local" && ctx.type === "local") return true;
    if (
      resolved.type === "remote" &&
      ctx.type === "remote" &&
      resolved.agentId === ctx.agentId
    )
      return true;
    return false;
  };

  const OsIcon = resolvedAgent ? osIcon(resolvedAgent.os) : Satellite;
  useEffect(() => {
    if (!open) return;
    if (resolved.type === "remote") setActiveTab("remote");
    else setActiveTab("local");
  }, [open, resolved.type]);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1.5 pl-2.5 pr-2 rounded-md text-xs font-medium transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)] max-w-[300px]",
            variant === "header"
              ? "ui-header-picker h-7"
              : isRemote
                ? "h-8 bg-primary/[0.08] border border-primary/20 text-primary hover:bg-primary/[0.12] shadow-sm"
                : "h-8 border border-border/50 bg-background/60 text-foreground/80 hover:bg-accent",
            variant === "header" && open && "is-open",
            disabled && "opacity-50 cursor-not-allowed",
            className,
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {isRemote ? (
              <>
                <span className="animate-live-breathe motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary opacity-30" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </>
            ) : (
              <span className="inline-flex h-2 w-2 rounded-full bg-success" />
            )}
          </span>
          {isRemote ? (
            <OsIcon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          ) : (
            <Desktop className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span className="truncate">
            {isRemote ? agentName : "Local"}
          </span>
          {isRemote && resolvedAgent?.latency_ms != null && (
            <span className={cn("text-2xs tabular-nums font-mono shrink-0", latencyColor(resolvedAgent.latency_ms))}>
              {resolvedAgent.latency_ms.toFixed(0)}ms
            </span>
          )}
          {hasOverride && <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />}
          <ChevronDown className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
            variant === "header"
              ? "text-muted-foreground/60"
              : isRemote
              ? "text-primary/60"
              : "text-muted-foreground/60",
            open && "rotate-180",
          )} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="ui-surface-card w-[380px] p-0 overflow-hidden"
      >
        <div className="ui-section-header-md">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/60" />
            <p className="section-label-sm">Execution Target</p>
          </div>
          <p className="text-2xs text-muted-foreground/60 mt-0.5 pl-6">
            Choose where this tool runs commands
          </p>
          <div className="mt-2 pl-6 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("local")}
              className={cn(
                "h-7 px-2.5 rounded-lg text-2xs font-medium transition-smooth",
                activeTab === "local"
                  ? "bg-success/15 text-success"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
              )}
            >
              Local
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("remote")}
              className={cn(
                "h-7 px-2.5 rounded-lg text-2xs font-medium transition-smooth",
                activeTab === "remote"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
              )}
            >
              Remote ({connectedAgents.length})
            </button>
          </div>
        </div>

        {activeTab === "local" && (
        <div className="ui-section-header-sm p-2">
          <button
            className={cn(
              "ui-choice-tile ui-choice-tone-primary w-full flex items-center gap-3 px-3 py-3 text-left",
              isActive({ type: "local" }) ? "is-active" : "",
            )}
            onClick={() => select({ type: "local" })}
          >
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", isActive({ type: "local" }) ? "bg-success/[0.1]" : "bg-muted/10")}>
              <Desktop className={cn("h-4.5 w-4.5", isActive({ type: "local" }) ? "text-success" : "text-muted-foreground/60")} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-xs font-medium", isActive({ type: "local" }) ? "text-foreground" : "text-foreground/70")}>
                Local Device
              </p>
              <p className="text-2xs text-muted-foreground/60 mt-0.5">Run directly on this device</p>
            </div>
            {isActive({ type: "local" }) && (
              <div className="h-5 w-5 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                <Check className="h-3 w-3 text-success" />
              </div>
            )}
          </button>
        </div>
        )}

        {activeTab === "remote" && (
        <>
        <div className="ui-section-header-sm px-4">
          <div className="flex items-center gap-2">
            <Satellite className="h-3.5 w-3.5 text-primary/70" />
            <p className="section-label-sm flex-1">Remote Agents</p>
            <span className="text-3xs tabular-nums text-muted-foreground/60 bg-muted/10 rounded px-1.5 py-px">
              {connectedAgents.length} agents
            </span>
          </div>
        </div>

        {connectedAgents.length > 3 && (
          <div className="px-3 py-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                placeholder="Search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-7 pl-7 pr-2 rounded-lg text-xs bg-muted/10 text-foreground placeholder:text-muted-foreground/60 outline-none focus:bg-muted/20 focus:ring-1 focus:ring-border/20 transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]"
              />
            </div>
          </div>
        )}

        <div className="px-1.5 pb-2 max-h-[320px] overflow-y-auto space-y-0.5">
          {connectedAgents.length === 0 && (
            <div className="px-4 py-6">
              <div className="flex flex-col items-center text-center">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2.5">
                  <Satellite className="h-5 w-5 text-primary/60" />
                </div>
                <p className="text-xs text-muted-foreground/70 font-medium">
                  No remote agents connected
                </p>
                <p className="text-2xs text-muted-foreground/60 mt-1 max-w-[240px] leading-relaxed">
                  Deploy an agent to run tools from a remote location
                </p>
                <button
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] bg-primary/10 text-primary hover:bg-primary/15"
                  onClick={() => {
                    setOpen(false);
                    navigateTo("remote-agent", "registry");
                  }}
                >
                  <Satellite className="h-3 w-3" />
                  Deploy Agent
                </button>
              </div>
            </div>
          )}
          {filteredAgents.map((agent) => {
            const ctx: ExecutionContext = { type: "remote", agentId: agent.id };
            const active = isActive(ctx);
            const AgentOsIcon = osIcon(agent.os);
            const uptime = agent.uptime_secs > 0 ? formatUptime(agent.uptime_secs) : null;

            return (
              <button
                key={agent.id}
                className={cn(
                  "ui-choice-tile w-full flex items-center gap-3 px-3 py-2.5 text-left",
                  osToneClass(agent.os),
                  active && "is-active",
                )}
                onClick={() => select(ctx)}
              >
                <div className="relative shrink-0">
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center", active ? "bg-primary/[0.1]" : "bg-muted/10")}>
                    <AgentOsIcon className={cn("h-4.5 w-4.5", active ? "text-primary" : "text-muted-foreground/60")} />
                  </div>
                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card/95 bg-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={cn("text-xs font-medium truncate", active ? "text-foreground" : "text-foreground/70")}>
                    {agent.name || agent.hostname}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-2xs text-muted-foreground/60 font-mono truncate">{agent.ip}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-2xs text-muted-foreground/60">{agent.os}</span>
                    {uptime && (
                      <>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="text-2xs text-muted-foreground/60 tabular-nums flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {uptime}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {agent.latency_ms != null && (
                    <Badge variant="secondary" className={cn("text-2xs font-mono", latencyColor(agent.latency_ms))}>
                      {agent.latency_ms.toFixed(0)}ms
                    </Badge>
                  )}
                  {active && (
                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        </>
        )}

        {toolId && hasOverride && (
          <div className="px-4 py-2.5 border-t border-border/20 flex items-center justify-between bg-warning/[0.03]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
              <p className="text-2xs text-muted-foreground/60 truncate">
                Override — global is <span className="font-medium text-foreground/60">{globalContextLabel}</span>
              </p>
            </div>
            <button
              className="text-2xs text-primary/70 hover:text-primary font-medium transition-smooth px-2 py-0.5 rounded-lg hover:bg-primary/[0.06] shrink-0"
              onClick={() => {
                clearToolOverride(toolId);
                setOpen(false);
              }}
            >
              Reset
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
