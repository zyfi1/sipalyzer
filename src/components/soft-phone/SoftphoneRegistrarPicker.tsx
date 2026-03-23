import { useEffect } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { getUseCase } from "@/components/fax-center/FaxShared";
import { RegistrarContextSelector } from "@/components/ui/registrar-context-selector";
import { Radio } from "@/lib/icons";

export function SoftphoneRegistrarPicker() {
  const {
    activeRegistrarId,
    setActiveRegistrar,
    inboundListenerActive,
    inboundListenerPort,
    inboundListenerPorts,
  } = useSoftphoneStore();
  const registrars = useRegistrationStore((s) => s.registrars);
  const registrarsForCalling = registrars.filter((r) =>
    getUseCase(r)?.split(",").map((s) => s.trim()).includes("calling"),
  );

  const selectedRegistrar = activeRegistrarId
    ? registrars.find((r) => r.id === activeRegistrarId)
    : null;

  useEffect(() => {
    if (activeRegistrarId && !registrarsForCalling.some((r) => r.id === activeRegistrarId)) {
      setActiveRegistrar(null);
    }
  }, [activeRegistrarId, registrarsForCalling, setActiveRegistrar]);

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

  return (
    <RegistrarContextSelector
      selectedRegistrarId={activeRegistrarId}
      onSelectRegistrar={(registrarId) => setActiveRegistrar(registrarId)}
      useCase="calling"
      title="Select Registrar"
      emptyTitle="No calling registrars"
      noSelectionLabel="Select registrar"
      noRegistrarLabel="No registrar available"
      footer={selectedRegistrar ? (
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
      ) : null}
    />
  );
}
