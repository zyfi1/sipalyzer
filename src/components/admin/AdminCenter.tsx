import { useState } from "react";
import { useToolStore } from "@/stores/toolStore";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import { navigateTo } from "@/lib/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Activity,
  Clock,
  Shield,
  Layers,
  ToggleLeft,
  Package,
} from "@/lib/icons";

import { TaskManagerView } from "./TaskManagerView";
import { AuditLogView } from "./AuditLogView";
import { DatabaseInspectorView } from "./DatabaseInspectorView";
import { FeatureFlagsView } from "./FeatureFlagsView";
import { AdminInventoryView } from "./AdminInventoryView";
import { AppDivider } from "@/components/ui/panel-chrome";

type AdminTab =
  | "tasks"
  | "audit"
  | "database"
  | "flags"
  | "inventory";

export function AdminCenter() {
  const [tab, setTab] = useState<AdminTab>("inventory");
  const previousToolId = useToolStore((s) => s.previousToolId);

  const handleBack = () => {
    navigateTo(previousToolId ?? HOME_TOOL_ID);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="ui-section-header-md flex items-center gap-3 px-4 py-3">
        <Button
          variant="neutral"
          size="sm"
          onClick={handleBack}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <AppDivider orientation="vertical" size="md" className="mx-0" />
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Admin Center</span>
        </div>
        <p className="text-xs text-muted-foreground ml-1 hidden md:block">
          Operational controls and diagnostics for advanced operators.
        </p>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AdminTab)}
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
      >
        <div className="px-4 pt-3">
          <TabsList className="settings-nav-tabs min-w-max">
            <TabsTrigger value="tasks" className="settings-nav-tab">
              <Activity className="h-4 w-4" />
              Task Manager
            </TabsTrigger>
            <TabsTrigger value="audit" className="settings-nav-tab">
              <Clock className="h-4 w-4" />
              Audit Log
            </TabsTrigger>
            <TabsTrigger value="database" className="settings-nav-tab">
              <Layers className="h-4 w-4" />
              Database
            </TabsTrigger>
            <TabsTrigger value="flags" className="settings-nav-tab">
              <ToggleLeft className="h-4 w-4" />
              Flags
            </TabsTrigger>
            <TabsTrigger value="inventory" className="settings-nav-tab">
              <Package className="h-4 w-4" />
              Inventory
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tasks" className="flex-1 min-h-0 overflow-auto mt-0">
          <TaskManagerView />
        </TabsContent>
        <TabsContent value="audit" className="flex-1 min-h-0 overflow-auto mt-0">
          <AuditLogView />
        </TabsContent>
        <TabsContent value="database" className="flex-1 min-h-0 overflow-auto mt-0">
          <DatabaseInspectorView />
        </TabsContent>
        <TabsContent value="flags" className="flex-1 min-h-0 overflow-auto mt-0">
          <FeatureFlagsView />
        </TabsContent>
        <TabsContent value="inventory" className="flex-1 min-h-0 overflow-auto mt-0">
          <AdminInventoryView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
