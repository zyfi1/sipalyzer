import { useComposerStore } from "@/stores/composerStore";
import { Settings } from "@/lib/icons";
import { cn } from "@/lib/utils";

type ComposerEnvironmentSelectProps = {
  className?: string;
  showManageButton?: boolean;
  onManage?: () => void;
};

export function ComposerEnvironmentSelect({
  className,
  showManageButton = false,
  onManage,
}: ComposerEnvironmentSelectProps) {
  const environments = useComposerStore((s) => s.environments);
  const activeEnvironmentId = useComposerStore((s) => s.activeEnvironmentId);
  const setActiveEnvironment = useComposerStore((s) => s.setActiveEnvironment);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <select
        value={activeEnvironmentId ?? ""}
        onChange={(e) => setActiveEnvironment(e.target.value || null)}
        className="flex-1 h-6 text-2xs bg-muted/20 rounded px-1.5 text-muted-foreground/70 hover:text-foreground focus:text-foreground focus:bg-muted/30 transition-smooth outline-none cursor-pointer"
      >
        <option value="">No Environment</option>
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
          </option>
        ))}
      </select>
      {showManageButton && onManage ? (
        <button
          type="button"
          aria-label="Manage environments"
          onClick={onManage}
          className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-smooth"
        >
          <Settings className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
