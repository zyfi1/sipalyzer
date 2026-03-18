/**
 * Hook to check if the current tool is the active (visible) tool.
 * Use this to pause expensive effects (polling, animations, intervals) when the tool is hidden.
 *
 * @param toolId - The ID of the tool calling this hook
 * @returns true if this tool is currently active/visible
 */
import { useToolStore } from "@/stores/toolStore";

export function useToolVisible(toolId: string): boolean {
  const activeToolId = useToolStore((s) => s.activeToolId);
  return activeToolId === toolId;
}
