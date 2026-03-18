/**
 * Hook that consolidates active context from all registered providers.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getActiveContextProviders,
  subscribeToRegistryRefresh,
  type ActiveContextItem,
} from "@/lib/activeContextRegistry";

export interface ActiveContext {
  items: ActiveContextItem[];
  hasAny: boolean;
}

export function useActiveContext(): ActiveContext {
  const [items, setItems] = useState<ActiveContextItem[]>([]);

  const update = useCallback(() => {
    const providers = getActiveContextProviders();
    const allItems = providers.flatMap((p) => p.getActiveItems());
    allItems.sort((a, b) => b.priority - a.priority);
    setItems(allItems);
  }, []);

  useEffect(() => {
    const providers = getActiveContextProviders();

    // Initial update
    update();

    // Subscribe to all providers
    const unsubs = providers.map((p) => p.subscribe(update));

    // Also subscribe to registry-level refresh (e.g., when lazy components load)
    const unsubRegistry = subscribeToRegistryRefresh(update);

    return () => {
      unsubs.forEach((u) => u());
      unsubRegistry();
    };
  }, [update]);

  return {
    items,
    hasAny: items.length > 0,
  };
}
