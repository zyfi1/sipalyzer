import { useMemo, useState } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import type { RegistrationResult } from "@/stores/registrationStore";
import { Shield, ArrowRight, CheckCircle, XCircle, Circle, Activity, RefreshCw } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/navigation";
import { EmptyState } from "@/components/ui/empty-state";

type RegistrationStatus = "registered" | "unregistered" | "failed";

function deriveStatus(result: RegistrationResult | undefined): RegistrationStatus {
  if (!result) return "unregistered";
  if ((result as any).unregistered) return "unregistered";
  if (result.status_text === "Not registered") return "unregistered";
  if (result.error?.toLowerCase().includes("timeout")) return "failed";
  if (!result.success) return "failed";
  if (result.status_code >= 200 && result.status_code < 300) return "registered";
  return "unregistered";
}

const STATUS_COLOR: Record<RegistrationStatus, string> = {
  registered: "bg-success",
  failed: "bg-destructive",
  unregistered: "bg-muted-foreground/30",
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  registered: "OK",
  failed: "Failed",
  unregistered: "Inactive",
};

export function RegistrationHealthSection() {
  const registrars = useRegistrationStore((s) => s.registrars);
  const testResults = useRegistrationStore((s) => s.testResults);
  const loading = useRegistrationStore((s) => s.loading);
  const [search, setSearch] = useState("");

  const statuses = useMemo(() => {
    return registrars.map((reg) => {
      const status = deriveStatus(reg.id ? testResults[reg.id] : undefined);
      return { reg, status };
    });
  }, [registrars, testResults]);

  const counts = useMemo(() => {
    const c = { registered: 0, failed: 0, unregistered: 0 };
    for (const { status } of statuses) c[status]++;
    return c;
  }, [statuses]);

  const filteredStatuses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statuses;
    return statuses.filter(({ reg }) => {
      const name = reg.name?.toLowerCase() ?? "";
      const domain = reg.domain?.toLowerCase() ?? "";
      return name.includes(q) || domain.includes(q);
    });
  }, [search, statuses]);

  const total = registrars.length;
  const healthPct = total > 0 ? Math.round((counts.registered / total) * 100) : 0;
  const ringColor = counts.failed > 0 ? "text-destructive" : counts.registered === total && total > 0 ? "text-success" : "text-warning";
  const healthLabel = counts.failed > 0 ? "Needs attention" : counts.registered === total && total > 0 ? "Healthy" : "Partial";

  return (
    <div className="surface relative flex flex-col h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/[0.09] via-primary/[0.04] to-transparent" />
      {total > 0 ? (
        <>
          {/* Hero summary */}
          <div className="relative px-5 pt-3.5 pb-2.5 shrink-0">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/12">
                  <Shield className="h-3.5 w-3.5 text-primary/80" />
                </div>
                <span className="text-3xs font-medium text-muted-foreground/50 uppercase tracking-wider">Registrations</span>
                {loading && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/55">
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    Refreshing
                  </span>
                )}
              </div>
              <span className="text-3xs tabular-nums text-muted-foreground/40">{total} total</span>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-border/35 bg-background/25 px-2.5 py-2 backdrop-blur-[1px]">
              {/* Ring gauge */}
              <div className="relative shrink-0">
                <svg viewBox="0 0 52 52" className="w-14 h-14 drop-shadow-[0_3px_10px_rgba(0,0,0,0.18)]">
                  <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="3.5"
                    className="text-muted-foreground/8"
                  />
                  <circle cx="24" cy="24" r="19" fill="none" strokeWidth="4"
                    stroke="currentColor"
                    className={ringColor}
                    strokeLinecap="round"
                    strokeDasharray={`${healthPct * 1.194} 119.4`}
                    transform="rotate(-90 24 24)"
                  />
                </svg>
                <span className={cn("absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums", ringColor)}>
                  {healthPct}%
                </span>
              </div>

              {/* Stat chips */}
              <div className="flex-1 min-w-0">
                <p className={cn("text-2xs font-medium", ringColor)}>{healthLabel}</p>
                <p className="text-3xs text-muted-foreground/45 mt-0.5">Live registrar readiness</p>
                <div className="grid grid-cols-2 gap-1 mt-1.5">
                  <div className="rounded-md border border-success/25 bg-success/10 px-1.5 py-1 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-success/80 shrink-0" />
                    <span className="text-3xs text-foreground/70"><b className="text-foreground">{counts.registered}</b> Active</span>
                  </div>
                  <div className="rounded-md border border-destructive/25 bg-destructive/10 px-1.5 py-1 flex items-center gap-1">
                    <XCircle className="h-3 w-3 text-destructive/80 shrink-0" />
                    <span className="text-3xs text-foreground/70"><b className="text-foreground">{counts.failed}</b> Failed</span>
                  </div>
                  <div className="rounded-md border border-border/45 bg-muted/15 px-1.5 py-1 flex items-center gap-1">
                    <Circle className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                    <span className="text-3xs text-foreground/70"><b className="text-foreground">{counts.unregistered}</b> Inactive</span>
                  </div>
                  <div className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-1 flex items-center gap-1">
                    <Activity className="h-3 w-3 text-primary/80 shrink-0" />
                    <span className="text-3xs text-foreground/70"><b className="text-foreground">{healthPct}%</b> Health</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Registrar list */}
          <div className="border-t border-border/30 flex-1 min-h-0 overflow-y-auto bg-gradient-to-b from-background/10 to-transparent">
            <div className="px-2 py-1.5 space-y-0.5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search registrars..."
                className="w-full h-7 rounded-md border border-border/30 bg-background/25 px-2 text-3xs text-foreground/70 placeholder:text-muted-foreground/35 outline-none focus:border-primary/40"
              />
              {filteredStatuses.length > 0 ? (
                filteredStatuses.map(({ reg, status }) => (
                  <button
                    key={reg.id ?? reg.domain}
                    type="button"
                    onClick={() => navigateTo("registration")}
                    className="w-full flex items-center gap-2 rounded-md border border-border/25 bg-background/20 px-2.5 py-1.5 text-left hover:bg-background/35 hover:border-border/45 transition-colors group"
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_COLOR[status])} />
                    <span className="text-xs text-foreground/70 truncate flex-1">{reg.name}</span>
                    <span className={cn(
                      "text-3xs tabular-nums shrink-0",
                      status === "registered" ? "text-success/70"
                        : status === "failed" ? "text-destructive/70"
                        : "text-muted-foreground/40",
                    )}>
                      {STATUS_LABEL[status]}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/20 opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0" />
                  </button>
                ))
              ) : (
                <EmptyState
                  compact
                  variant="inline"
                  title="No matching registrars"
                  className="rounded-md border border-border/25 bg-background/20 px-2.5 py-2"
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="relative px-5 pt-4 pb-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/12">
                <Shield className="h-3.5 w-3.5 text-primary/80" />
              </div>
              <span className="text-3xs font-medium text-muted-foreground/50 uppercase tracking-wider">Registrations</span>
            </div>
          </div>
          <EmptyState
            compact
            variant="inline"
            icon={<Shield />}
            title="No registrars configured"
            className="flex-1 pb-4"
          />
        </>
      )}
    </div>
  );
}
