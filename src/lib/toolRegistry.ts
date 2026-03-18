import { ComponentType } from "react";
import type { IconComponent } from "@/lib/icons";

export interface ToolSubView {
  id: string;
  label: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description?: string;
  icon: IconComponent;
  component: ComponentType;
  route: string;
  /** Subviews shown in sidebar when expanded (folder style). Only when sidebar is expanded. */
  subviews?: ToolSubView[];
  /** If true, the tool is registered for navigation but hidden from sidebar and palette. */
  hidden?: boolean;
}

/** Tool id for the default home view. Always first in the list and default view. */
export const HOME_TOOL_ID = "troubleshooting";

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      // Silently skip duplicate registration to avoid console warnings
      // This can happen during hot module reloading in development
      return;
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  /** Returns all tools with home (default) always first. */
  getAll(): ToolDefinition[] {
    const list = Array.from(this.tools.values());
    const home = list.find((t) => t.id === HOME_TOOL_ID);
    if (!home) return list;
    return [home, ...list.filter((t) => t.id !== HOME_TOOL_ID)];
  }

  getByRoute(route: string): ToolDefinition | undefined {
    return Array.from(this.tools.values()).find((tool) => tool.route === route);
  }
}

export const toolRegistry = new ToolRegistry();
