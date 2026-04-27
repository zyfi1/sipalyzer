import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { Check, ChevronDown } from "@/lib/icons";
import { getUseCase, isRegistered } from "@/components/fax-center/FaxShared";

type RegistrarUseCase = "calling" | "faxing";

interface RegistrarContextSelectorProps {
  selectedRegistrarId: string | null;
  onSelectRegistrar: (registrarId: string | null) => void;
  useCase: RegistrarUseCase;
  title: string;
  emptyTitle: string;
  noSelectionLabel: string;
  noRegistrarLabel: string;
  footer?: ReactNode;
}

export function RegistrarContextSelector({
  selectedRegistrarId,
  onSelectRegistrar,
  useCase,
  title,
  emptyTitle,
  noSelectionLabel,
  noRegistrarLabel,
  footer,
}: RegistrarContextSelectorProps) {
  const [open, setOpen] = useState(false);
  const [registeringRegistrarId, setRegisteringRegistrarId] = useState<string | null>(null);
  const registrars = useRegistrationStore((s) => s.registrars);
  const testRegistration = useRegistrationStore((s) => s.testRegistration);
  const testResults = useRegistrationStore((s) => s.testResults);
  const healthRegistrars = useTroubleshootingStore((s) => s.registrationHealth?.registrars);

  const registrarsForUseCase = useMemo(
    () =>
      registrars.filter((r) => {
        const parsedUseCases = getUseCase(r)?.split(",").map((s) => s.trim()) ?? [];
        return parsedUseCases.includes(useCase);
      }),
    [registrars, useCase],
  );

  const selectedRegistrar = selectedRegistrarId
    ? registrars.find((r) => r.id === selectedRegistrarId) ?? null
    : null;

  useEffect(() => {
    if (selectedRegistrarId && !registrarsForUseCase.some((r) => r.id === selectedRegistrarId)) {
      onSelectRegistrar(null);
    }
  }, [onSelectRegistrar, registrarsForUseCase, selectedRegistrarId]);

  const selectedLabel = selectedRegistrar
    ? `${selectedRegistrar.name} — ${selectedRegistrar.username}@${selectedRegistrar.domain}`
    : (registrarsForUseCase.length ? noSelectionLabel : noRegistrarLabel);

  return (
    <div className="flex min-w-0 w-full max-w-[19rem] items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-w-0 w-full max-w-full items-center gap-1.5 rounded-md border text-xs font-medium",
              "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
              "ui-header-picker h-7 truncate",
              open && "is-open",
              selectedRegistrar ? "text-foreground/80" : "is-muted",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                selectedRegistrar
                  ? isRegistered(selectedRegistrar.id, healthRegistrars, testResults)
                    ? "bg-success status-online"
                    : "bg-destructive"
                  : "bg-muted-foreground/20",
              )}
            />
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={6}
          collisionPadding={{ top: 4, right: 12, bottom: 8, left: 8 }}
          className="ui-floating-surface w-[min(24.5rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)] overflow-hidden p-0"
        >
          <div className="ui-section-header-sm">
            <p className="section-label-sm">{title}</p>
          </div>

          <div className="max-h-[240px] overflow-y-auto py-1">
            {registrarsForUseCase.length === 0 ? (
              <EmptyState
                compact
                variant="inline"
                title={emptyTitle}
                className="items-start px-3 py-3 text-left"
              />
            ) : (
              registrarsForUseCase.map((r) => {
                const active = r.id === selectedRegistrarId;
                const ready = isRegistered(r.id, healthRegistrars, testResults);
                return (
                  <div
                    key={r.id ?? r.name}
                    className={cn(
                      "w-full flex min-h-11 items-center gap-2.5 px-3 py-2 text-left transition-smooth",
                      active
                        ? "bg-accent text-foreground"
                        : "text-foreground/70 hover:bg-muted/20 hover:text-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRegistrar(r.id ?? null);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={cn(
                          "h-4 w-4 rounded-full shrink-0 flex items-center justify-center border transition-smooth",
                          active ? "border-foreground/20 bg-muted/40" : "border-border bg-transparent",
                        )}
                      >
                        {active && <Check className="h-2.5 w-2.5 text-foreground" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-tight truncate">{r.name}</p>
                        <p className="text-2xs leading-tight text-muted-foreground/60 font-mono truncate">
                          {r.username}@{r.domain}
                        </p>
                      </div>
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", ready ? "bg-success status-online" : "bg-warning")} />
                      <span className="text-2xs text-muted-foreground/70 shrink-0">{ready ? "Ready" : "Idle"}</span>
                    </button>
                    {!ready && (
                      <button
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          if (!r.id || registeringRegistrarId) return;
                          setRegisteringRegistrarId(r.id);
                          try {
                            const context = useExecutionContextStore.getState().resolvedContext("registration");
                            await testRegistration(r.id, context);
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
          {footer}
        </PopoverContent>
      </Popover>
    </div>
  );
}
