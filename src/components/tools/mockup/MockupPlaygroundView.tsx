import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { LiveIndicator } from "@/components/ui/live-indicator";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ExecutionContextSelector } from "@/components/ui/execution-context-selector";
import { RegistrarContextSelector } from "@/components/ui/registrar-context-selector";
import { SoftphoneRegistrarPicker } from "@/components/soft-phone/SoftphoneRegistrarPicker";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { AppDivider } from "@/components/ui/panel-chrome";
import { ResultSourceBadge } from "@/components/network-test/components/ResultSourceBadge";
import { IpBadge } from "@/components/layout/header-items/IpBadge";
import { ToolSubTabs } from "@/components/ui/tool-sub-tabs";
import { SearchButton } from "@/components/layout/header-items/SearchButton";
import { NotesButton } from "@/components/layout/header-items/NotesButton";
import { SettingsButton } from "@/components/layout/header-items/SettingsButton";
import { ViewSubheader, ViewSubheaderCount, ViewSubheaderSpacer } from "@/components/layout/ViewSubheader";
import { openGlobalContextMenuAt } from "@/hooks/useGlobalContextMenuHandler";
import { useLayoutStore } from "@/stores/layoutStore";
import {
  AlertTriangle,
  LayoutDashboard,
  Search,
  Settings,
  Shield,
  Sparkles,
  Wrench,
} from "@/lib/icons";

export function MockupPlaygroundView() {
  const [switchA, setSwitchA] = useState(true);
  const [switchB, setSwitchB] = useState(false);
  const [checkA, setCheckA] = useState(true);
  const [checkB, setCheckB] = useState(false);
  const [radioValue, setRadioValue] = useState("a");
  const [showSuccessConfirm, setShowSuccessConfirm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const [catalogSubTab, setCatalogSubTab] = useState<"overview" | "requests" | "history">("overview");
  const [mockFaxRegistrarId, setMockFaxRegistrarId] = useState<string | null>(null);
  const [mockSelectValue, setMockSelectValue] = useState("sip");
  const setSearchOpen = useLayoutStore((s) => s.setSearchOpen);

  return (
    <div className="app-view-stack pb-6">
      <Card className="ui-hero-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            App UI Inventory
          </CardTitle>
          <CardDescription>Organized by category for fast design review. Redundant examples removed.</CardDescription>
        </CardHeader>
      </Card>

      <ViewSubheader>
        <ViewSubheaderCount count={7} label="groups" icon={<LayoutDashboard className="h-3.5 w-3.5" />} />
        <ViewSubheaderCount count={56} label="elements" icon={<Wrench className="h-3.5 w-3.5" />} />
        <ViewSubheaderCount count={1} label="interactive test group" icon={<Settings className="h-3.5 w-3.5" />} />
        <ViewSubheaderSpacer />
        <LiveIndicator variant="badge" size="xs" label="CATALOG" />
      </ViewSubheader>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">App Shell Controls</CardTitle>
            <CardDescription>Header strip, registrar (calling), and execution context (same components as production).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border/45 bg-card/40 p-2">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/12 px-2 py-1.5">
                <SearchButton variant="icon" />
                <span className="ml-auto flex items-center gap-2">
                  <NotesButton onClick={() => {}} />
                  <SettingsButton onClick={() => {}} />
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border/35 bg-muted/10 px-2 py-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-success">connected</span>
                </div>
                <AppDivider orientation="vertical" size="md" className="mx-0" />
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="tabular-nums text-foreground">18ms</span>
                  <span className="text-muted-foreground">p95</span>
                </div>
                <AppDivider orientation="vertical" size="md" className="mx-0" />
                <div className="flex items-center gap-1.5 text-warning">
                  <span className="tabular-nums">2</span>
                  <span>warnings</span>
                </div>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Registrar (calling — soft phone)</p>
                <SoftphoneRegistrarPicker />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Execution context</p>
                <ExecutionContextSelector />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Navigation / Tabs</CardTitle>
            <CardDescription>App-level and subview tab patterns.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="subview-tabs-compact">
              <button type="button" className="subview-tab-compact" data-state="active">Overview</button>
              <button type="button" className="subview-tab-compact" data-state="inactive">Sessions</button>
              <button type="button" className="subview-tab-compact" data-state="inactive">Alerts</button>
            </div>
            <ToolSubTabs
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "requests", label: "Requests" },
                { id: "history", label: "History" },
              ]}
              activeTab={catalogSubTab}
              onTabChange={(tab) => setCatalogSubTab(tab)}
              trailing={<Badge variant="secondary">3</Badge>}
            />
            <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
              Active subview: <span className="font-medium text-foreground">{catalogSubTab}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">App dropdown</CardTitle>
            <CardDescription>
              Single component <code className="text-[11px]">AppDropdown</code> for list selection (and menu mode elsewhere).
              Three sizes share one trigger system (<code className="text-[11px]">dropdown-control</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/45 bg-card/40 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Header-height pickers (review alignment)</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="text-2xs text-muted-foreground">Registrar (faxing)</p>
                  <RegistrarContextSelector
                    selectedRegistrarId={mockFaxRegistrarId}
                    onSelectRegistrar={setMockFaxRegistrarId}
                    useCase="faxing"
                    title="Fax registrar"
                    emptyTitle="No faxing registrars"
                    noSelectionLabel="Select fax registrar"
                    noRegistrarLabel="No fax registrar"
                  />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-2xs text-muted-foreground">Calling (same as header)</p>
                  <SoftphoneRegistrarPicker />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-2xs text-muted-foreground">Execution</p>
                  <ExecutionContextSelector />
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border/40 bg-muted/10 p-3">
              <p className="mb-3 text-xs font-medium text-muted-foreground">
                Same <code className="text-[11px]">AppDropdown</code> — only <span className="text-foreground/90">size</span> changes
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                {(["sm", "md", "lg"] as const).map((sz) => (
                  <div key={sz} className="space-y-2">
                    <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{sz}</p>
                    <AppDropdown
                      size={sz}
                      value={mockSelectValue}
                      onValueChange={setMockSelectValue}
                      options={[
                        { value: "sip", label: "SIP" },
                        { value: "http", label: "HTTP" },
                        { value: "graphql", label: "GraphQL" },
                        { value: "ssh", label: "SSH" },
                      ]}
                      placeholder="Protocol"
                      className="w-full min-w-0 max-w-[280px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Control size scale (sm / md / lg)</CardTitle>
            <CardDescription>
              Same vertical rhythm: <code className="text-[11px]">Button</code>,{" "}
              <code className="text-[11px]">AppDropdown</code>, and{" "}
              <code className="text-[11px]">Input</code> use shared CSS variables{" "}
              <code className="text-[11px]">--ui-control-height-sm|md|lg</code>. Compare each column — edges
              should line up.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border/45 bg-card/40 p-3">
              <div className="grid gap-4 md:grid-cols-3">
                {(["sm", "md", "lg"] as const).map((sz) => (
                  <div
                    key={sz}
                    className="space-y-3 rounded-md border border-border/35 bg-muted/10 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-2">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {sz}
                      </p>
                      <span className="font-mono text-[10px] text-muted-foreground/80 tabular-nums">
                        {sz === "sm" && "1.75rem"}
                        {sz === "md" && "2.25rem"}
                        {sz === "lg" && "2.5rem"}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-2xs text-muted-foreground">Button</p>
                      <Button size={sz} variant="secondary" className="w-full min-w-0">
                        Action
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-2xs text-muted-foreground">AppDropdown</p>
                      <AppDropdown
                        size={sz}
                        value={mockSelectValue}
                        onValueChange={setMockSelectValue}
                        options={[
                          { value: "sip", label: "SIP" },
                          { value: "http", label: "HTTP" },
                          { value: "graphql", label: "GraphQL" },
                        ]}
                        placeholder="Protocol"
                        className="w-full min-w-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-2xs text-muted-foreground">Input (filter-style)</p>
                      <Input size={sz} placeholder="Filter…" className="font-mono" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>Canonical button system and icon actions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Primary</Button>
              <Button variant="secondary" size="sm">Secondary</Button>
              <Button variant="success" size="sm">Success</Button>
              <Button variant="destructive" size="sm">Destructive</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="link" size="sm" linkKind="internal">Internal Link</Button>
              <Button variant="link" size="sm" linkKind="external">External Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="icon-sm"><Search className="h-4 w-4" /></Button>
              <Button variant="secondary" size="icon-md"><Settings className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs / Selection</CardTitle>
            <CardDescription>Text input and interactive controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Filter by host, call-id, tenant..." />
            <Textarea placeholder='{"query":"status","include":"metrics"}' />
            <div className="flex items-center gap-3">
              <Switch checked={switchA} onCheckedChange={setSwitchA} size="sm" />
              <Switch checked={switchB} onCheckedChange={setSwitchB} size="md" />
              <Switch checked={switchA} onCheckedChange={setSwitchA} size="lg" />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox size="sm" checked={checkA} onCheckedChange={(v) => setCheckA(v === true)} />
              <Checkbox size="md" checked={checkB} onCheckedChange={(v) => setCheckB(v === true)} />
              <Checkbox size="lg" checked={checkA} onCheckedChange={(v) => setCheckA(v === true)} />
            </div>
            <RadioGroup value={radioValue} onValueChange={setRadioValue} className="flex items-center gap-3">
              <RadioGroupItem size="sm" value="a" aria-label="A" />
              <RadioGroupItem size="md" value="b" aria-label="B" />
              <RadioGroupItem size="lg" value="c" aria-label="C" />
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data / Status</CardTitle>
            <CardDescription>Real status surfaces used across the app (network, source, badges, progress).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/45 bg-muted/10 p-2">
              <p className="mb-2 text-xs text-muted-foreground">Network / IP Badge (real header element)</p>
              <IpBadge />
            </div>
            <div className="rounded-md border border-border/45 bg-muted/10 p-2">
              <p className="mb-2 text-xs text-muted-foreground">Result Source Badges (real test surfaces)</p>
              <div className="flex flex-wrap items-center gap-2">
                <ResultSourceBadge source="local" />
                <ResultSourceBadge source="remote" agentName="edge-agent-chi-01" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="primary">Primary</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
            <Progress value={72} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overlays / Menus</CardTitle>
            <CardDescription>Actual app overlays and menus (same components used in production views).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/45 bg-muted/10 p-2 space-y-2">
              <p className="text-xs text-muted-foreground">Header Search Overlay (real)</p>
              <div className="max-w-[320px]">
                <SearchButton variant="field" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSearchOpen(true)}>
                  Open Global Search Dialog
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openGlobalContextMenuAt(rect.left + 8, rect.bottom + 8);
                  }}
                >
                  Open Global Context Menu
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              In the <span className="font-medium text-foreground">App dropdown</span> card above: header-style registrar/execution
              row, then <code className="text-[11px]">AppDropdown</code> at sm / md / lg (same component for list fields app-wide).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feedback / Empty States</CardTitle>
            <CardDescription>Alerts, loading treatment, dialogs, and empty-state components.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>Local capture status degraded on one host</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border/45 bg-muted/10 px-2 py-1.5 text-xs">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span>RBAC policy sync is healthy</span>
            </div>
            <div className="flex items-center gap-3">
              <Spinner className="size-5 text-primary" />
              <LiveIndicator variant="dot" size="sm" />
              <LiveIndicator variant="badge" size="sm" label="LIVE" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" size="sm" onClick={() => setShowSuccessConfirm(true)}>Success Dialog</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowConfirm(true)}>Default Confirm</Button>
              <Button variant="destructive" size="sm" onClick={() => setShowDangerConfirm(true)}>Destructive Confirm</Button>
            </div>
            <EmptyState
              variant="card"
              icon={<Wrench />}
              title="No terminal output yet"
              description="Start a command to stream output here."
              action={<Button size="sm" variant="secondary">Run command</Button>}
            />
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Inventory focused on real app patterns only.
          </CardFooter>
        </Card>
      </div>

      <ConfirmDialog
        open={showSuccessConfirm}
        onOpenChange={setShowSuccessConfirm}
        title="Saved successfully"
        description="Capture profile and execution settings were applied across active tabs."
        confirmText="Great"
        cancelText="Close"
        variant="success"
        onConfirm={() => setShowSuccessConfirm(false)}
      />
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Apply network profile changes?"
        description="This will update active diagnostics sampling and restart affected monitors."
        confirmText="Apply Changes"
        cancelText="Not now"
        variant="neutral"
        onConfirm={() => setShowConfirm(false)}
      />
      <ConfirmDialog
        open={showDangerConfirm}
        onOpenChange={setShowDangerConfirm}
        title="Delete selected capture?"
        description="This permanently removes the capture session and related diagnostics."
        confirmText="Delete Capture"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => setShowDangerConfirm(false)}
      />
    </div>
  );
}

