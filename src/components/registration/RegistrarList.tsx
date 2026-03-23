import { useRegistrationStore } from "@/stores/registrationStore";
import { useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Server } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

type StatusGroup = "registered" | "failed" | "unregistered" | "unknown";

interface RegistrarListProps {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  folderFilter: string | null;
  statusFilter: StatusGroup | null;
}

export function RegistrarList({
  selectedId,
  onSelectId,
  folderFilter,
  statusFilter,
}: RegistrarListProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const testResults = useRegistrationStore((s) => s.testResults);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const lastSource = useRegistrationStore((s) => s.lastSource);

  const deriveStatus = useCallback((id: string): StatusGroup => {
    const result = testResults[id];
    if (result) {
      if ((result as any)?.unregistered === true) return "unregistered";
      return result.success ? "registered" : "failed";
    }
    const suite = testSuites[id];
    if (suite) {
      const basicTest = suite.tests.find((t: any) => t.test_type === "basic_registration");
      if (basicTest) {
        if ((basicTest.result as any)?.unregistered === true) return "unregistered";
        return basicTest.result.success ? "registered" : "failed";
      }
      return suite.overall_success ? "registered" : "failed";
    }
    return "unknown";
  }, [testResults, testSuites]);

  const visibleRegistrars = useMemo(() => {
    let filtered = registrars;
    if (folderFilter === "__ungrouped__") filtered = registrars.filter((r) => !r.group);
    else if (folderFilter) filtered = registrars.filter((r) => r.group === folderFilter);
    if (statusFilter) filtered = filtered.filter((r) => deriveStatus(r.id!) === statusFilter);
    return filtered;
  }, [registrars, folderFilter, statusFilter, deriveStatus]);

  if (registrars.length === 0) {
      return (
      <div className="h-full flex items-center justify-center p-4">
        <EmptyState variant="inline" icon={<Server />} title="No registrars" description='Click "Add" to get started.' />
      </div>
    );
  }

  if (visibleRegistrars.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <EmptyState compact variant="inline" title="No registrars match this filter" />
      </div>
    );
  }

  const statusDotClass = (status: StatusGroup) => {
    switch (status) {
      case "registered": return "bg-success shadow-sm shadow-success/40 status-online";
      case "failed": return "bg-destructive shadow-sm shadow-destructive/40";
      case "unregistered": return "bg-warning status-warning";
      case "unknown": return "bg-muted-foreground/30";
    }
  };

  return (
    <div className="flex flex-col">
      {visibleRegistrars.map((registrar) => {
        if (!registrar.id) return null;
        const id = registrar.id;
        return (
          <RegistrarListRow
            key={id}
            id={id}
            registrar={registrar}
            status={deriveStatus(id)}
            isSelected={selectedId === id}
            result={testResults[id]}
            isViaAgent={lastSource[id]?.source === "remote"}
            onSelectId={onSelectId}
            statusDotClass={statusDotClass}
          />
        );
      })}
    </div>
  );
}

interface RegistrarListRowProps {
  id: string;
  registrar: ReturnType<typeof useRegistrationStore.getState>["registrars"][number];
  status: StatusGroup;
  isSelected: boolean;
  result: ReturnType<typeof useRegistrationStore.getState>["testResults"][string] | undefined;
  isViaAgent: boolean;
  onSelectId: (id: string) => void;
  statusDotClass: (status: StatusGroup) => string;
}

function RegistrarListRow({
  id,
  registrar,
  status,
  isSelected,
  result,
  isViaAgent,
  onSelectId,
  statusDotClass,
}: RegistrarListRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `registrar:${id}`,
    data: { type: "registrar", registrarId: id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelectId(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectId(id);
        }
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "flex cursor-grab flex-col gap-0.5 border-b border-border/25 px-3 py-2.5 text-left transition-smooth active:cursor-grabbing focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/55",
        isSelected ? "border-l-2 border-l-primary bg-primary/10" : "border-l-2 border-l-transparent hover:bg-muted/15",
        isDragging && "opacity-70 shadow-md"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <TooltipWrapper entry={tooltips.regStatusDot(status)}>
          <span className={cn("h-[6px] w-[6px] rounded-full shrink-0", statusDotClass(status))} />
        </TooltipWrapper>
        <span className="text-[13px] font-medium text-foreground truncate flex-1">{registrar.name}</span>
        {isViaAgent && (
          <TooltipWrapper entry={tooltips.regAgentBadge}>
            <span className="text-[8px] text-primary/60 shrink-0 cursor-help">agent</span>
          </TooltipWrapper>
        )}
        {result && result.status_code > 0 && !(result as any).unregistered && (
          <TooltipWrapper entry={tooltips.regResponseCode}>
            <span className={cn(
              "text-[10px] font-mono shrink-0 tabular-nums cursor-help",
              status === "registered" ? "text-success/70" : status === "failed" ? "text-destructive/70" : "text-muted-foreground/50",
            )}>
              {result.status_code}
            </span>
          </TooltipWrapper>
        )}
      </div>
      <div className="flex items-center gap-2 pl-[14px] min-w-0">
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{registrar.username}@{registrar.domain}</span>
        {result && result.response_time_ms > 0 && !(result as any).unregistered && (
          <TooltipWrapper entry={tooltips.regResponseTime}>
            <span className="text-[9px] text-muted-foreground/40 tabular-nums shrink-0 cursor-help">{result.response_time_ms}ms</span>
          </TooltipWrapper>
        )}
      </div>
    </div>
  );
}
