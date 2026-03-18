import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useRemoteChatStore } from "@/stores/remoteChatStore";
import { cn } from "@/lib/utils";
import { Search } from "@/lib/icons";
import { EmptyState } from "@/components/ui/empty-state";

interface RemoteChatPanelProps {
  compact?: boolean;
  active?: boolean;
  agentId?: string;
}

export function RemoteChatPanel({
  compact = false,
  active = true,
  agentId,
}: RemoteChatPanelProps) {
  const scopedToAgent = Boolean(agentId);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agentId ?? "__all__");
  const [agentSearch, setAgentSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [draft, setDraft] = useState("");

  const connections = useRemoteAgentStore((s) => s.connections);
  const {
    messages,
    unreadByAgent,
    hydrated,
    hydrate,
    sendMessage,
    markRead,
  } = useRemoteChatStore((s) => ({
    messages: s.messages,
    unreadByAgent: s.unreadByAgent,
    hydrated: s.hydrated,
    hydrate: s.hydrate,
    sendMessage: s.sendMessage,
    markRead: s.markRead,
  }));

  useEffect(() => {
    if (!active) return;
    if (!hydrated) {
      hydrate().catch(() => {});
    }
  }, [active, hydrated, hydrate]);

  useEffect(() => {
    if (!agentId) return;
    setSelectedAgentId(agentId);
  }, [agentId]);

  useEffect(() => {
    if (scopedToAgent) return;
    if (selectedAgentId && selectedAgentId !== "__all__") return;
    const firstConnected = connections.find((c) => c.status === "connected")?.id;
    if (firstConnected) setSelectedAgentId(firstConnected);
  }, [scopedToAgent, connections, selectedAgentId]);

  const agents = useMemo(
    () => {
      const list = connections
        .filter((c) => c.status === "connected" || messages.some((m) => m.agentId === c.id))
        .map((c) => ({
          id: c.id,
          label: c.name || c.hostname || c.id.slice(0, 8),
          unread: unreadByAgent[c.id] ?? 0,
        }));
      if (!agentId) return list;
      const scoped = list.find((item) => item.id === agentId);
      if (scoped) return [scoped];
      return [{ id: agentId, label: agentId.slice(0, 8), unread: unreadByAgent[agentId] ?? 0 }];
    },
    [connections, messages, unreadByAgent, agentId],
  );

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }, [agentSearch, agents]);

  const targetAgentId = useMemo(() => {
    if (scopedToAgent && agentId) return agentId;
    if (selectedAgentId && selectedAgentId !== "__all__") return selectedAgentId;
    return filteredAgents[0]?.id ?? null;
  }, [scopedToAgent, agentId, selectedAgentId, filteredAgents]);

  const targetConnected = useMemo(
    () => (targetAgentId ? connections.some((c) => c.id === targetAgentId && c.status === "connected") : false),
    [connections, targetAgentId],
  );

  const conversation = useMemo(
    () => {
      const byAgent =
        selectedAgentId === "__all__"
          ? messages
          : messages.filter((m) => m.agentId === selectedAgentId);
      const q = messageSearch.trim().toLowerCase();
      const filtered = q
        ? byAgent.filter(
            (m) =>
              m.text.toLowerCase().includes(q) ||
              m.sender.toLowerCase().includes(q) ||
              m.agentId.toLowerCase().includes(q),
          )
        : byAgent;
      return filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    },
    [messages, selectedAgentId, messageSearch],
  );

  useEffect(() => {
    if (!active) return;
    if (!selectedAgentId) return;
    if (selectedAgentId === "__all__") {
      if (Object.values(unreadByAgent).some((n) => n > 0)) {
        markRead().catch(() => {});
      }
      return;
    }
    if ((unreadByAgent[selectedAgentId] ?? 0) > 0) {
      markRead(selectedAgentId).catch(() => {});
    }
  }, [active, selectedAgentId, unreadByAgent, markRead]);

  const onSend = async () => {
    if (!targetAgentId) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(targetAgentId, text).catch(() => {
      setDraft(text);
    });
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      {!scopedToAgent && (
        <div className={cn("surface w-56 shrink-0 p-2", compact && "w-44")}>
          <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Connected Agents</div>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agents..."
              className="h-8 pl-8 ui-control-shell"
            />
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setSelectedAgentId("__all__")}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-xs transition",
                selectedAgentId === "__all__" ? "bg-primary/15 text-foreground" : "hover:bg-muted/60 text-muted-foreground",
              )}
            >
              <span>All Agents</span>
            </button>
            {filteredAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedAgentId(agent.id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-xs transition",
                  selectedAgentId === agent.id ? "bg-primary/15 text-foreground" : "hover:bg-muted/60 text-muted-foreground",
                )}
              >
                <span>{agent.label}</span>
                {agent.unread > 0 && <span className="ml-2 text-[10px] text-primary">({agent.unread})</span>}
              </button>
            ))}
            {!agents.length && (
              <EmptyState
                variant="inline"
                compact
                title="No connected agents"
                className="items-start p-2 pt-2 text-left"
              />
            )}
          </div>
        </div>
      )}

      <div className="surface flex min-h-0 flex-1 flex-col">
        <div className="ui-section-header-sm">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {selectedAgentId ? "Remote Chat" : "Select an agent to chat"}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={messageSearch}
              onChange={(e) => setMessageSearch(e.target.value)}
              placeholder="Search messages..."
              className="h-8 pl-8 ui-control-shell"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <div className="space-y-2">
            {conversation.map((message) => (
              <div key={message.id} className={cn("max-w-[90%] rounded-md px-2 py-1.5 text-xs", message.sender === "controller" ? "ml-auto bg-primary/15 text-foreground" : "bg-muted text-foreground")}>
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{message.sender}</span>
                  <span className="rounded bg-background/60 px-1.5 py-0.5">
                    {message.sender === "controller"
                      ? "Sent"
                      : message.unread
                        ? "Unread"
                        : "Read"}
                  </span>
                </div>
                <div>{message.text}</div>
                <div className="mt-1 text-[10px] text-muted-foreground/80">
                  {selectedAgentId === "__all__" ? `${message.agentId} · ` : ""}
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {!conversation.length && (
              <EmptyState
                variant="inline"
                compact
                title="No messages yet."
                className="items-start p-0 pt-0 text-left"
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border/50 p-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSend();
              }
            }}
            disabled={!targetAgentId || selectedAgentId === "__all__" || !targetConnected}
            placeholder={
              selectedAgentId === "__all__"
                ? "Select an agent to send"
                : !targetConnected
                  ? "Agent offline"
                  : targetAgentId
                  ? "Type a message..."
                  : "Pick an online agent"
            }
          />
          <Button
            onClick={() => void onSend()}
            disabled={!targetAgentId || selectedAgentId === "__all__" || !targetConnected || !draft.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

