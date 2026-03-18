/**
 * Registry for status indicators shown in the Workspace status bar.
 * Tools register components that display health/status information.
 */

import type { ComponentType } from "react";

export interface StatusIndicator {
  id: string;
  toolId: string;
  /** Higher = shown first (left side) */
  priority: number;
  /** Component to render in the status bar */
  component: ComponentType<{ onClick?: () => void }>;
}

const indicators: StatusIndicator[] = [];

export function registerStatusIndicator(indicator: StatusIndicator): void {
  // Avoid duplicate registration
  if (indicators.some((i) => i.id === indicator.id)) return;
  indicators.push(indicator);
}

export function getStatusIndicators(): StatusIndicator[] {
  return [...indicators].sort((a, b) => b.priority - a.priority);
}

export function unregisterStatusIndicator(id: string): void {
  const idx = indicators.findIndex((i) => i.id === id);
  if (idx !== -1) indicators.splice(idx, 1);
}
