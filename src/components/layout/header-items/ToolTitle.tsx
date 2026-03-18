import { useToolStore } from "@/stores/toolStore";
import { TOOL_COLORS } from "@/lib/toolColors";
import { cn } from "@/lib/utils";

/**
 * Renders the active tool's icon + name in the header.
 * Always shown — breadcrumb dropdowns follow for tools with subviews.
 */
export function ToolTitle() {
  const activeTool = useToolStore((s) => s.getActiveTool());

  if (!activeTool) return null;

  const toolColor = TOOL_COLORS[activeTool.id];

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0 app-chrome-content-swap">
      {activeTool.icon && (
        <activeTool.icon className={cn("h-3.5 w-3.5 shrink-0", toolColor?.icon ?? "text-muted-foreground")} />
      )}
      <span className="text-xs font-medium text-foreground truncate whitespace-nowrap">
        {activeTool.name}
      </span>
    </div>
  );
}
