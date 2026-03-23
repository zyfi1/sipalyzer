import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshCw, ToggleLeft } from "@/lib/icons";
import { listFeatureFlags, setFeatureFlag, type FeatureFlag } from "@/api/admin";
import { cn } from "@/lib/utils";
import {
  FEATURE_FLAG_KNOWLEDGE_BASE_UI,
  FEATURE_FLAG_MCP_UI,
  FEATURE_FLAG_TOOLS_MOCKUP_UI,
} from "@/lib/featureFlags";
import { setCachedFeatureFlag } from "@/lib/featureFlagCache";
import { ADMIN_PANEL, ADMIN_VIEW_CONTAINER } from "./viewStyles";

interface FlagDefinition {
  key: string;
  label: string;
  description: string;
  section: string;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: FEATURE_FLAG_KNOWLEDGE_BASE_UI,
    label: "Knowledge Base UI",
    description: "Enable Knowledge Base links, icons, and KB entry points across the app",
    section: "Troubleshooting",
  },
  {
    key: FEATURE_FLAG_MCP_UI,
    label: "MCP Tool UI",
    description: "Enable the MCP tab in Tools (Mission Control + hosted MCP controls)",
    section: "Tools",
  },
  {
    key: FEATURE_FLAG_TOOLS_MOCKUP_UI,
    label: "Mockup Playground UI",
    description: "Enable the Mockup tab in Tools (UI playground / design experiments)",
    section: "Tools",
  },
];

const SECTION_ORDER: string[] = [
  "Tools",
  "Troubleshooting",
];

export function FeatureFlagsView() {
  const queryClient = useQueryClient();
  const [togglingKeys, setTogglingKeys] = useState<Set<string>>(new Set());

  const featureFlagsQuery = useQuery<FeatureFlag[]>({
    queryKey: ["admin", "feature-flags"],
    queryFn: async () => {
      const list = await listFeatureFlags();
      for (const flag of list) {
        setCachedFeatureFlag(flag.key, flag.enabled);
      }
      return list;
    },
  });

  const setFeatureFlagMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      setFeatureFlag(key, enabled),
  });

  const flags = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const flag of featureFlagsQuery.data ?? []) {
      map.set(flag.key, flag.enabled);
    }
    return map;
  }, [featureFlagsQuery.data]);

  const setFlagInCache = (key: string, enabled: boolean) => {
    setCachedFeatureFlag(key, enabled);
    queryClient.setQueryData<FeatureFlag[]>(["admin", "feature-flags"], (prev = []) => {
      let found = false;
      const next = prev.map((flag) => {
        if (flag.key !== key) return flag;
        found = true;
        return { ...flag, enabled };
      });
      if (!found) {
        next.push({ key, enabled });
      }
      return next;
    });
  };

  const handleToggle = async (key: string, enabled: boolean) => {
    setTogglingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      await setFeatureFlagMutation.mutateAsync({ key, enabled });
      setFlagInCache(key, enabled);
    } catch {
      // silent
    } finally {
      setTogglingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSectionToggle = async (
    sectionKeys: string[],
    enabled: boolean,
  ) => {
    const targetKeys = sectionKeys.filter(
      (key) => (flags.get(key) ?? false) !== enabled,
    );
    if (targetKeys.length === 0) return;

    setTogglingKeys((prev) => {
      const next = new Set(prev);
      for (const key of targetKeys) next.add(key);
      return next;
    });

    try {
      await Promise.all(
        targetKeys.map(async (key) => {
          try {
            await setFeatureFlagMutation.mutateAsync({ key, enabled });
            setFlagInCache(key, enabled);
          } catch {
            // silent for per-flag failure
          }
        }),
      );
    } finally {
      setTogglingKeys((prev) => {
        const next = new Set(prev);
        for (const key of targetKeys) next.delete(key);
        return next;
      });
    }
  };

  const handleRefresh = async () => {
    await featureFlagsQuery.refetch();
  };

  const sections = SECTION_ORDER.map((section) => ({
    name: section,
    flags: FLAG_DEFINITIONS.filter((f) => f.section === section),
  })).filter((s) => s.flags.length > 0);

  const totalFlags = FLAG_DEFINITIONS.length;
  const enabledCount = FLAG_DEFINITIONS.filter((f) => flags.get(f.key)).length;
  const hasContent = totalFlags > 0;

  return (
    <div className={ADMIN_VIEW_CONTAINER}>
      {/* Toolbar */}
      <div className={ADMIN_PANEL}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-sm font-semibold tabular-nums">
            {enabledCount}
          </span>
          <span className="text-xs text-muted-foreground">
            of {totalFlags} flags enabled
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleRefresh}
              disabled={featureFlagsQuery.isFetching}
              className="h-8 text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1 ${featureFlagsQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {!hasContent ? (
        <div className={cn("flex-1 flex items-center justify-center p-6", ADMIN_PANEL)}>
          <EmptyState
            icon={<ToggleLeft className="h-7 w-7" />}
            title="No feature flags"
            description="Feature flags will appear here once they are added."
          />
        </div>
      ) : (
        <>
          {/* Defined flag sections */}
          {sections.map((section) => (
            <div
              key={section.name}
              className={ADMIN_PANEL}
            >
              <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-foreground/90 uppercase tracking-wide">{section.name}</p>
                {section.flags.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-muted-foreground uppercase tracking-wide">
                      Group
                    </span>
                    <Switch
                      checked={section.flags.every(
                        (def) => flags.get(def.key) ?? false,
                      )}
                      onCheckedChange={(checked) =>
                        handleSectionToggle(
                          section.flags.map((f) => f.key),
                          checked,
                        )
                      }
                      disabled={section.flags.some((def) =>
                        togglingKeys.has(def.key),
                      )}
                    />
                  </div>
                )}
              </div>
              <div className="divide-y divide-border/30">
                {section.flags.map((def) => {
                  const isEnabled = flags.get(def.key) ?? false;
                  const isToggling = togglingKeys.has(def.key);

                  return (
                    <div
                      key={def.key}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {def.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {def.description}
                        </p>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) =>
                          handleToggle(def.key, checked)
                        }
                        disabled={isToggling}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground px-1">
            Feature flags take effect immediately. Some may require restarting
            the app for full effect.
          </p>
        </>
      )}
    </div>
  );
}
