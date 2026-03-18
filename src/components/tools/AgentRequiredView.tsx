import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { Satellite } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

interface AgentRequiredViewProps {
  selectedAgentId: string | null;
  onAgentChange: (agentId: string) => void;
  children: React.ReactNode;
  title: string;
  description: string;
}

/**
 * Wrapper that gates tool views behind a connected remote agent.
 * Shows an agent selector at the top and an empty state when no agents are connected.
 */
export function AgentRequiredView({
  selectedAgentId,
  onAgentChange,
  children,
  title,
  description,
}: AgentRequiredViewProps) {
  const connections = useRemoteAgentStore((s) => s.connections);
  if (connections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <EmptyState
            icon={<Satellite />}
            title="No agent connected"
            description={`${title} requires a remote agent. Connect an agent to get started.`}
            action={(
              <TooltipWrapper content="Navigate to the Remote Agent tool to connect an agent">
                <button
                  onClick={() => navigateTo("remote-agent")}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-smooth",
                    "bg-primary/10 text-primary hover:bg-primary/20",
                  )}
                >
                  <Satellite className="h-3.5 w-3.5" />
                  Go to Remote Agent
                </button>
              </TooltipWrapper>
            )}
            className="border-0 bg-transparent p-0"
          />
        </div>
      </div>
    );
  }

  const agent = connections.find((c) => c.id === selectedAgentId) ?? connections[0];
  const effectiveAgentId = agent?.id ?? "";

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Agent selector bar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <Satellite className="h-3.5 w-3.5" />
          <span className="font-medium">Agent</span>
        </div>
        <Select value={effectiveAgentId} onValueChange={onAgentChange}>
          <TooltipWrapper content="Select which connected remote agent to use">
            <SelectTrigger className="w-[280px] h-8 text-xs">
              <SelectValue placeholder="Select an agent…" />
            </SelectTrigger>
          </TooltipWrapper>
          <SelectContent>
            {connections.map((conn) => (
              <SelectItem key={conn.id} value={conn.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-success status-online shrink-0" />
                  <span className="font-medium">{conn.name || conn.hostname}</span>
                  <span className="text-muted-foreground/60 font-mono">{conn.ip}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-2xs text-muted-foreground/60 ml-auto">{description}</p>
      </div>

      {/* Tool content */}
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
