/**
 * Registry for quick actions shown on the Workspace when idle.
 * Tools register actions that appear as cards/buttons.
 */

import type { IconComponent } from "@/lib/icons";

export interface QuickAction {
  id: string;
  toolId: string;
  label: string;
  description: string;
  icon: IconComponent;
  /** Higher = shown first */
  priority: number;
  onClick: () => void;
}

const actions: QuickAction[] = [];

export function registerQuickAction(action: QuickAction): void {
  // Avoid duplicate registration
  if (actions.some((a) => a.id === action.id)) return;
  actions.push(action);
}

export function getQuickActions(): QuickAction[] {
  return [...actions].sort((a, b) => b.priority - a.priority);
}

export function unregisterQuickAction(id: string): void {
  const idx = actions.findIndex((a) => a.id === id);
  if (idx !== -1) actions.splice(idx, 1);
}
