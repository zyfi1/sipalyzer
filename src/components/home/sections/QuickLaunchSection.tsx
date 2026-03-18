import { Eye, Gauge, Terminal, Send, Shield, Scan, Satellite, Lightbulb } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { IconComponent } from "@/lib/icons";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAG_KNOWLEDGE_BASE_UI } from "@/lib/featureFlags";
import { navigateTo } from "@/lib/navigation";

interface Shortcut {
  icon: IconComponent;
  label: string;
  toolId: string;
  subviewId?: string;
  requiresKnowledgeBase?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { icon: Eye, label: "New Capture", toolId: "packet-capture" },
  { icon: Gauge, label: "Speed Test", toolId: "network", subviewId: "connectivity" },
  { icon: Terminal, label: "SSH", toolId: "composer", subviewId: "ssh" },
  { icon: Send, label: "Send Fax", toolId: "fax-center", subviewId: "send" },
  { icon: Shield, label: "Registration", toolId: "registration" },
  { icon: Scan, label: "SIP Discovery", toolId: "network", subviewId: "devices" },
  { icon: Satellite, label: "Agents", toolId: "remote-agent" },
  { icon: Lightbulb, label: "Knowledge Base", toolId: "troubleshooting", requiresKnowledgeBase: true },
];

export function QuickLaunchSection() {
  const { enabled: knowledgeBaseEnabled } = useFeatureFlag(FEATURE_FLAG_KNOWLEDGE_BASE_UI);
  const shortcuts = SHORTCUTS.filter((s) => !s.requiresKnowledgeBase || knowledgeBaseEnabled);

  return (
    <div className="surface p-4 flex flex-col gap-2.5 h-full overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h2 className="text-xs font-semibold text-foreground/70">Quick Launch</h2>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 overflow-y-auto flex-1 min-h-0 -mx-1 px-1 content-start">
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.toolId + (s.subviewId ?? "")}
              type="button"
              onClick={() => navigateTo(s.toolId, s.subviewId)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-1.5 py-2.5",
                "bg-muted/10 hover:bg-muted/20 transition-colors",
                "group cursor-pointer",
              )}
            >
              <Icon className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground/70 transition-colors" />
              <span className="text-3xs text-muted-foreground/60 group-hover:text-foreground/70 transition-colors text-center leading-tight">
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
