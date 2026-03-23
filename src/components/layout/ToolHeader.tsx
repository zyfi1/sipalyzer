import { useEffect } from "react";
import { useToolStore } from "@/stores/toolStore";
import {
  useBreadcrumb,
  useBreadcrumbStore,
  type BreadcrumbItem,
} from "@/stores/breadcrumbStore";

export interface ToolHeaderProps {
  toolId: string;
  /** Navigation items for the Level 0 breadcrumb dropdown */
  items?: BreadcrumbItem[];
  /** Currently active item ID */
  value?: string;
  /** Called when the user selects a different item from the dropdown */
  onValueChange?: (id: string) => void;
  /** Execution context tool ID — renders an ExecutionContextSelector in the header */
  execToolId?: string;
}

/**
 * Headless tool header — registers navigation data in the breadcrumb store
 * (e.g. sidebar tertiary tabs). Center search is HeaderUnifiedOmniBar, not breadcrumbs.
 */
export function ToolHeader({
  toolId,
  items,
  value,
  onValueChange,
  execToolId,
}: ToolHeaderProps) {
  useBreadcrumb(
    toolId,
    0,
    items ?? [],
    value ?? "",
    onValueChange ?? (() => {}),
  );

  const isActive = useToolStore((s) => s.activeToolId === toolId);
  const setExecToolId = useBreadcrumbStore((s) => s.setExecToolId);
  const clearExecToolId = useBreadcrumbStore((s) => s.clearExecToolId);

  useEffect(() => {
    if (isActive && execToolId) {
      setExecToolId(toolId, execToolId);
    } else if (isActive && !execToolId) {
      clearExecToolId(toolId);
    }
  }, [isActive, toolId, execToolId, setExecToolId, clearExecToolId]);

  useEffect(() => () => clearExecToolId(toolId), [toolId, clearExecToolId]);

  return null;
}
