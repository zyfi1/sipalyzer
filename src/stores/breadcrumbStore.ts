import { create } from "zustand";
import { useCallback, useEffect, useRef } from "react";
import { useToolStore } from "@/stores/toolStore";

export interface BreadcrumbItem {
  id: string;
  label: string;
}

export interface BreadcrumbSegment {
  items: BreadcrumbItem[];
  value: string;
  onChange: (id: string) => void;
}

interface BreadcrumbState {
  /** segments[toolId][level] — each tool registers its navigation levels */
  segments: Record<string, Record<number, BreadcrumbSegment>>;
  /** execToolIds[toolId] — the execution-context tool ID for the trailing selector */
  execToolIds: Record<string, string>;

  setSegment: (toolId: string, level: number, segment: BreadcrumbSegment) => void;
  clearSegment: (toolId: string, level: number) => void;
  setExecToolId: (toolId: string, execToolId: string) => void;
  clearExecToolId: (toolId: string) => void;
}

export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  segments: {},
  execToolIds: {},

  setSegment: (toolId, level, segment) =>
    set((s) => ({
      segments: {
        ...s.segments,
        [toolId]: { ...s.segments[toolId], [level]: segment },
      },
    })),

  clearSegment: (toolId, level) =>
    set((s) => {
      const toolSegs = { ...s.segments[toolId] };
      delete toolSegs[level];
      return { segments: { ...s.segments, [toolId]: toolSegs } };
    }),

  setExecToolId: (toolId, execToolId) =>
    set((s) => ({ execToolIds: { ...s.execToolIds, [toolId]: execToolId } })),

  clearExecToolId: (toolId) =>
    set((s) => {
      const ids = { ...s.execToolIds };
      delete ids[toolId];
      return { execToolIds: ids };
    }),
}));

/**
 * Register a breadcrumb navigation segment for the active tool.
 * Only registers when the specified tool is the active tool.
 * Cleans up on unmount.
 */
export function useBreadcrumb(
  toolId: string,
  level: number,
  items: BreadcrumbItem[],
  value: string,
  onChange: (id: string) => void,
) {
  const isToolActive = useToolStore((s) => s.activeToolId === toolId);
  const setSegment = useBreadcrumbStore((s) => s.setSegment);
  const clearSegment = useBreadcrumbStore((s) => s.clearSegment);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stableCallback = useCallback((id: string) => onChangeRef.current(id), []);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (isToolActive && itemsRef.current.length > 0) {
      setSegment(toolId, level, {
        items: itemsRef.current,
        value,
        onChange: stableCallback,
      });
    }
  }, [isToolActive, toolId, level, value, stableCallback, setSegment]);

  useEffect(() => () => clearSegment(toolId, level), [toolId, level, clearSegment]);
}
