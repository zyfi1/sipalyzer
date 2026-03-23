import { useState } from "react";
import { useNotificationStore, SOURCE_LABELS } from "@/stores/notificationStore";
import type { NotificationSource, NotificationType } from "@/stores/notificationStore";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { ChevronRight } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function NotificationSettings() {
  const settings = useNotificationStore((s) => s.settings);
  const updateSettings = useNotificationStore((s) => s.updateSettings);
  const toggleSourceMute = useNotificationStore((s) => s.toggleSourceMute);
  const { notify } = useNotifications();
  const [testType, setTestType] = useState<NotificationType>("info");
  const [expandedSections, setExpandedSections] = useState({
    preview: false,
    display: false,
    behavior: false,
    source: true,
    history: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const setAllSections = (expanded: boolean) => {
    setExpandedSections({
      preview: expanded,
      display: expanded,
      behavior: expanded,
      source: expanded,
      history: expanded,
    });
  };

  const sourceEntries = Object.entries(SOURCE_LABELS) as [NotificationSource, string][];

  return (
    <div className="h-full min-h-0 space-y-3 p-4">
      <div className="ui-panel-shell rounded-md px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Configure notification behavior with editor-style defaults and compact controls.
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="neutral" size="sm" className="h-8 px-2.5 text-2xs" onClick={() => setAllSections(true)}>
              Expand all
            </Button>
            <Button variant="neutral" size="sm" className="h-8 px-2.5 text-2xs" onClick={() => setAllSections(false)}>
              Collapse all
            </Button>
          </div>
        </div>
      </div>
      {/* Preview / testing */}
      <div className="space-y-2">
        <button
          type="button"
          className="w-full ui-control-shell flex items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent/35 transition-smooth"
          onClick={() => toggleSection("preview")}
          aria-expanded={expandedSections.preview}
        >
          <h3 className="text-sm font-semibold">Preview</h3>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expandedSections.preview && "rotate-90 text-foreground",
            )}
          />
        </button>
        {expandedSections.preview && (
          <div className="ui-panel-shell rounded-md p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Send a sample notification to validate the center and toast style.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-full sm:w-44">
                <AppDropdown
                  id="test-notification-type"
                  value={testType}
                  onValueChange={(value) => setTestType(value as NotificationType)}
                  options={[
                    { value: "info", label: "Info" },
                    { value: "success", label: "Success" },
                    { value: "warning", label: "Warning" },
                    { value: "error", label: "Error" },
                    { value: "system", label: "System" },
                  ]}
                />
              </div>
              <Button
                variant="positive"
                size="sm"
                onClick={() => {
                  notify({
                    type: testType,
                    title: "Test notification",
                    description: "Preview from Settings > Notifications.",
                    source: "settings",
                    priority: testType === "error" ? "high" : "normal",
                  });
                }}
              >
                Send test notification
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Display Options */}
      <div className="space-y-2">
        <button
          type="button"
          className="w-full ui-control-shell flex items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent/35 transition-smooth"
          onClick={() => toggleSection("display")}
          aria-expanded={expandedSections.display}
        >
          <h3 className="text-sm font-semibold">Display</h3>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expandedSections.display && "rotate-90 text-foreground",
            )}
          />
        </button>
        {expandedSections.display && (
          <div className="ui-panel-shell rounded-md divide-y divide-border/30">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="show-toasts" className="cursor-pointer">Show toast notifications</Label>
                <p className="text-xs text-muted-foreground">Display temporary popup notifications</p>
              </div>
              <Switch
                id="show-toasts"
                checked={settings.showToasts}
                onCheckedChange={(checked) => updateSettings({ showToasts: checked })}
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="show-center" className="cursor-pointer">Save to notification center</Label>
                <p className="text-xs text-muted-foreground">Keep notifications in history</p>
              </div>
              <Switch
                id="show-center"
                checked={settings.showInCenter}
                onCheckedChange={(checked) => updateSettings({ showInCenter: checked })}
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="group-similar" className="cursor-pointer">Group by time</Label>
                <p className="text-xs text-muted-foreground">Group notifications by Today, Yesterday, etc.</p>
              </div>
              <Switch
                id="group-similar"
                checked={settings.groupSimilar}
                onCheckedChange={(checked) => updateSettings({ groupSimilar: checked })}
                size="sm"
              />
            </div>
            <div className="px-3 py-2.5 space-y-2">
              <Label htmlFor="position">Toast position</Label>
              <AppDropdown
                id="position"
                className="w-full sm:w-48"
                value={settings.position}
                onValueChange={(value) =>
                  updateSettings({
                    position: value as "top-right" | "top-left" | "bottom-right" | "bottom-left",
                  })
                }
                options={[
                  { value: "top-right", label: "Top Right" },
                  { value: "top-left", label: "Top Left" },
                  { value: "bottom-right", label: "Bottom Right" },
                  { value: "bottom-left", label: "Bottom Left" },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      {/* Behavior */}
      <div className="space-y-2">
        <button
          type="button"
          className="w-full ui-control-shell flex items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent/35 transition-smooth"
          onClick={() => toggleSection("behavior")}
          aria-expanded={expandedSections.behavior}
        >
          <h3 className="text-sm font-semibold">Behavior</h3>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expandedSections.behavior && "rotate-90 text-foreground",
            )}
          />
        </button>
        {expandedSections.behavior && (
          <div className="ui-panel-shell rounded-md divide-y divide-border/30">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="do-not-disturb" className="cursor-pointer">Do not disturb</Label>
                <p className="text-xs text-muted-foreground">Suppress all toast notifications. Notifications are still saved to history.</p>
              </div>
              <Switch
                id="do-not-disturb"
                checked={settings.doNotDisturb}
                onCheckedChange={(checked) => updateSettings({ doNotDisturb: checked })}
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="sound-enabled" className="cursor-pointer">Notification sound</Label>
                <p className="text-xs text-muted-foreground">Play a sound when a notification arrives</p>
              </div>
              <Switch
                id="sound-enabled"
                checked={settings.soundEnabled}
                onCheckedChange={(checked) => updateSettings({ soundEnabled: checked })}
                size="sm"
              />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="auto-dismiss" className="cursor-pointer">Auto-dismiss</Label>
                <p className="text-xs text-muted-foreground">Automatically dismiss toast notifications after a delay</p>
              </div>
              <Switch
                id="auto-dismiss"
                checked={settings.autoDismiss}
                onCheckedChange={(checked) => updateSettings({ autoDismiss: checked })}
                size="sm"
              />
            </div>
            {settings.autoDismiss && (
              <div className="px-3 py-2.5 space-y-2">
                <Label htmlFor="duration">Dismiss after (seconds)</Label>
                <Input
                  id="duration"
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  className="w-full sm:w-32 h-8 text-sm"
                  value={Math.round(settings.autoDismissDuration / 1000)}
                  onChange={(e) => {
                    const seconds = parseInt(e.target.value) || 5;
                    updateSettings({ autoDismissDuration: seconds * 1000 });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-Source Muting */}
      <div className="space-y-2">
        <button
          type="button"
          className="w-full ui-control-shell flex items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent/35 transition-smooth"
          onClick={() => toggleSection("source")}
          aria-expanded={expandedSections.source}
        >
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Source Notifications</h3>
            <p className="text-xs text-muted-foreground">
              Mute toast notifications from specific tools. Muted notifications are still saved to the notification center.
            </p>
          </div>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform shrink-0",
              expandedSections.source && "rotate-90 text-foreground",
            )}
          />
        </button>
        {expandedSections.source && (
          <div className="ui-panel-shell rounded-md divide-y divide-border/30">
            {sourceEntries.map(([source, label]) => {
              const isMuted = settings.mutedSources.includes(source);
              return (
                <div key={source} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm">{label}</span>
                    {isMuted && (
                      <Badge variant="secondary" className="text-3xs px-1.5 py-0.5 ui-control-shell">
                        Muted
                      </Badge>
                    )}
                  </div>
                  <Switch
                    id={`source-${source}`}
                    checked={!isMuted}
                    onCheckedChange={() => toggleSourceMute(source)}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      <div className="space-y-2">
        <button
          type="button"
          className="w-full ui-control-shell flex items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent/35 transition-smooth"
          onClick={() => toggleSection("history")}
          aria-expanded={expandedSections.history}
        >
          <h3 className="text-sm font-semibold">History</h3>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              expandedSections.history && "rotate-90 text-foreground",
            )}
          />
        </button>
        {expandedSections.history && (
          <div className="ui-panel-shell rounded-md p-3 space-y-2">
            <Label htmlFor="max-history">Maximum history items</Label>
            <Input
              id="max-history"
              type="number"
              min="10"
              max="1000"
              step="10"
              className="w-full sm:w-32 h-8 text-sm"
              value={settings.maxHistory}
              onChange={(e) =>
                updateSettings({ maxHistory: parseInt(e.target.value) || 100 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Keep the last {settings.maxHistory} notifications in history
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
