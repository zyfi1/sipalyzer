import { useMemo } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { Settings } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDropdown, type AppDropdownSize } from "@/components/ui/app-dropdown";

const NO_ENV_VALUE = "__composer_env_none__";

type ComposerEnvironmentSelectProps = {
  className?: string;
  showManageButton?: boolean;
  onManage?: () => void;
  size?: AppDropdownSize;
};

export function ComposerEnvironmentSelect({
  className,
  showManageButton = false,
  onManage,
  size = "md",
}: ComposerEnvironmentSelectProps) {
  const environments = useComposerStore((s) => s.environments);
  const activeEnvironmentId = useComposerStore((s) => s.activeEnvironmentId);
  const setActiveEnvironment = useComposerStore((s) => s.setActiveEnvironment);

  const options = useMemo(
    () => [
      { value: NO_ENV_VALUE, label: "No Environment" },
      ...environments
        .filter((env) => env.id !== NO_ENV_VALUE)
        .map((env) => ({ value: env.id, label: env.name })),
    ],
    [environments],
  );

  const selectValue = activeEnvironmentId ?? NO_ENV_VALUE;

  const manageBtnClass =
    size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <AppDropdown
        size={size}
        value={selectValue}
        onValueChange={(v) => setActiveEnvironment(v === NO_ENV_VALUE ? null : v)}
        options={options}
        placeholder="No Environment"
        className="min-w-0 flex-1"
      />
      {showManageButton && onManage ? (
        <button
          type="button"
          aria-label="Manage environments"
          onClick={onManage}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border/50",
            "bg-linear-to-b from-card/90 to-muted/50 text-muted-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)]",
            "hover:border-border/70 hover:text-foreground hover:from-card hover:to-muted/58 transition-[color,background-color,border-color] duration-[var(--motion-duration-micro)]",
            "focus-visible:shadow-focus outline-none",
            manageBtnClass,
          )}
        >
          <Settings className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </button>
      ) : null}
    </div>
  );
}
