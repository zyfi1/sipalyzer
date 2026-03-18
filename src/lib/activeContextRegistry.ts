/**
 * Registry for active context providers.
 * Tools register providers that return active items to display on the Workspace.
 */

import type { ComponentType } from "react";

export interface ActiveContextItem {
  id: string;
  toolId: string;
  /** Higher = shown first (e.g. calls > captures > faxes) */
  priority: number;
  /** Component to render for this active item */
  component: ComponentType<{ onNavigate: () => void }>;
}

export interface ActiveContextProvider {
  toolId: string;
  /** Returns active items to show on workspace, or empty array if nothing active */
  getActiveItems: () => ActiveContextItem[];
  /** Subscribe to changes; returns unsubscribe function */
  subscribe: (callback: () => void) => () => void;
}

const providers: ActiveContextProvider[] = [];

// Global listeners for registry-level events (e.g., components loaded)
const globalListeners: Set<() => void> = new Set();

export function registerActiveContextProvider(provider: ActiveContextProvider): void {
  // Avoid duplicate registration
  if (providers.some((p) => p.toolId === provider.toolId)) return;
  providers.push(provider);
}

export function getActiveContextProviders(): ActiveContextProvider[] {
  return providers;
}

export function unregisterActiveContextProvider(toolId: string): void {
  const idx = providers.findIndex((p) => p.toolId === toolId);
  if (idx !== -1) providers.splice(idx, 1);
}

/**
 * Subscribe to registry-level refresh events (e.g., when lazy components finish loading).
 * Returns unsubscribe function.
 */
export function subscribeToRegistryRefresh(callback: () => void): () => void {
  globalListeners.add(callback);
  return () => globalListeners.delete(callback);
}

/**
 * Notify all subscribers to refresh their active context.
 * Call this after lazy-loaded components become available.
 */
export function notifyRegistryRefresh(): void {
  globalListeners.forEach((cb) => cb());
}
