import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useToolStore } from "@/stores/toolStore";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { ChevronDown, Check, Radio } from "@/lib/icons";
import { getUseCase, isRegistered } from "@/components/fax-center/FaxShared";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

export function SoftphoneHeader() {
  const {
    activeRegistrarId,
    setActiveRegistrar,
    inboundListenerActive,
    inboundListenerPort,
    inboundListenerPorts,
  } = useSoftphoneStore();
  const registrars = useRegistrationStore((s) => s.registrars);
  const testRegistration = useRegistrationStore((s) => s.testRegistration);
  const testResults = useRegistrationStore((s) => s.testResults);
  const healthRegistrars = useTroubleshootingStore((s) => s.registrationHealth?.registrars);
  const registrarsForCalling = registrars.filter(
    (r) => { const uc = getUseCase(r); return uc?.split(",").map((s) => s.trim()).includes("calling"); }
  );

  const selectedRegistrar = activeRegistrarId
    ? registrars.find((r) => r.id === activeRegistrarId)
    : null;
  const isRegisteredForCalling = activeRegistrarId
    ? isRegistered(activeRegistrarId, healthRegistrars, testResults)
    : false;

  const [open, setOpen] = useState(false);
  const [registeringRegistrarId, setRegisteringRegistrarId] = useState<string | null>(null);

  // Clear selected registrar if it is no longer visible
  useEffect(() => {
    if (activeRegistrarId && !registrarsForCalling.some((r) => r.id === activeRegistrarId)) {
      setActiveRegistrar(null);
    }
  }, [activeRegistrarId, registrarsForCalling, setActiveRegistrar]);

  const triggerLabel = selectedRegistrar
    ? `${selectedRegistrar.name} — ${selectedRegistrar.username}@${selectedRegistrar.domain}`
    : (registrarsForCalling.length ? "Select registrar" : "No registrar available");
  const fullInboundPorts = inboundListenerPorts.length > 0
    ? inboundListenerPorts
    : (inboundListenerPort ? [inboundListenerPort] : []);
  const visibleInboundPorts = fullInboundPorts.slice(0, 4);
  const hiddenInboundPortsCount = Math.max(0, fullInboundPorts.length - visibleInboundPorts.length);
  const inboundPortsSummary =
    visibleInboundPorts.length > 0
      ? `:${visibleInboundPorts.join(", :")}${hiddenInboundPortsCount > 0 ? ` +${hiddenInboundPortsCount}` : ""}`
      : "";
  const inboundPortsTooltip =
    fullInboundPorts.length > 0
      ? `Active ports: ${fullInboundPorts.map((p) => `:${p}`).join(", ")}`
      : "No active inbound ports";

  const registrarPicker = (
    <div className="flex items-center gap-2 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "ui-header-picker w-[min(320px,30vw)] truncate",
              open && "is-open",
              selectedRegistrar ? "text-foreground/80" : "is-muted",
            )}
          >
            {/* Status dot */}
            <span className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              isRegisteredForCalling ? "bg-success" : selectedRegistrar ? "bg-destructive" : "bg-muted-foreground/20",
            )} />
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="ui-floating-surface w-[380px] overflow-hidden p-0"
        >
          {/* Header */}
          <div className="ui-section-header-sm">
            <p className="section-label-sm">
              Select Registrar
            </p>
          </div>

          {/* List */}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {registrarsForCalling.length === 0 ? (
              <EmptyState
                compact
                variant="inline"
                title="No calling registrars"
                className="items-start px-3 py-3 text-left"
              />
            ) : (
              registrarsForCalling.map((r) => {
                const isActive = r.id === activeRegistrarId;
                const ready = isRegistered(r.id, healthRegistrars, testResults);
                return (
                  <div
                    key={r.id ?? r.name}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-smooth",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-foreground/70 hover:bg-muted/20 hover:text-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRegistrar(r.id ?? null);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      {/* Check or radio dot */}
                      <span className={cn(
                        "h-4 w-4 rounded-full shrink-0 flex items-center justify-center border transition-smooth",
                        isActive
                          ? "border-foreground/20 bg-muted/40"
                          : "border-border bg-transparent",
                      )}>
                        {isActive && <Check className="h-2.5 w-2.5 text-foreground" />}
                      </span>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.name}</p>
                        <p className="text-2xs text-muted-foreground/60 font-mono truncate">
                          {r.username}@{r.domain}
                        </p>
                      </div>

                      {/* Status badge */}
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        ready ? "bg-success" : "bg-warning",
                      )} />
                      <span className="text-3xs text-muted-foreground/70 shrink-0">{ready ? "Ready" : "Idle"}</span>
                    </button>
                    {!ready && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!r.id || registeringRegistrarId) return;
                          setRegisteringRegistrarId(r.id);
                          try {
                            const ctx = useExecutionContextStore.getState().resolvedContext("registration");
                            await testRegistration(r.id, ctx);
                          } finally {
                            setRegisteringRegistrarId(null);
                          }
                        }}
                        disabled={!!registeringRegistrarId}
                        className={cn(
                          "ui-control-shell h-6 px-2 text-2xs font-medium transition-smooth shrink-0",
                          "hover:bg-accent hover:border-border/70",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                        )}
                      >
                        {registeringRegistrarId === r.id ? "..." : "Register"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with listener info */}
          {selectedRegistrar && (
            <div className="px-3 py-2 border-t border-border/20 flex items-center gap-2">
              {inboundListenerActive && (inboundListenerPorts.length > 0 || inboundListenerPort) ? (
                <>
                  <Radio className="h-3 w-3 text-info" />
                  <TooltipWrapper title="Inbound listeners" description={inboundPortsTooltip}>
                    <span className="text-2xs text-info/70">
                      Listening {inboundPortsSummary}
                    </span>
                  </TooltipWrapper>
                </>
              ) : (
                <span className="text-2xs text-muted-foreground/60">Inbound listener off</span>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );

  const isActive = useToolStore((s) => s.activeToolId === "soft-phone");

  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderPortal(document.getElementById("header-tool-widget-custom"));
  }, []);

  if (!isActive || !headerPortal) return null;

  return createPortal(
    <>
      {registrarPicker}
    </>,
    headerPortal,
  );
}
