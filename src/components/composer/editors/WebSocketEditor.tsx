/**
 * WebSocket Editor — connect, send/receive messages, live message log.
 * Uses the browser's native WebSocket API (works in Tauri webview).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useComposerStore, interpolateVariables } from "@/stores/composerStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToastContext } from "@/contexts/ToastContext";
import {
  Zap,
  Send,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  X,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ComposerItem, WebSocketData, WebSocketMessage } from "@/types/composer";

interface Props {
  item: ComposerItem;
}

function validateWebSocketUrl(url: string): string | null {
  if (!url.trim()) return "WebSocket URL is required.";
  if (!/^wss?:\/\//i.test(url)) return "WebSocket URL must start with ws:// or wss://.";
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return "WebSocket URL must include a hostname.";
  } catch {
    return "WebSocket URL is not valid.";
  }
  return null;
}

export function WebSocketEditor({ item }: Props) {
  const updateItem = useComposerStore((s) => s.updateItem);
  const markTabDirty = useComposerStore((s) => s.markTabDirty);
  const addHistoryEntry = useComposerStore((s) => s.addHistoryEntry);
  const toast = useToastContext();

  const ws = item.wsData!;

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const setData = useCallback(
    (updates: Partial<WebSocketData>) => {
      updateItem(item.id, { wsData: { ...ws, ...updates } });
      markTabDirty(item.id, true);
    },
    [updateItem, item.id, ws, markTabDirty]
  );

  // Auto-scroll message log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const handleConnect = useCallback(() => {
    if (connected || connecting) return;
    setError(null);
    setConnecting(true);

    try {
      const resolvedUrl = interpolateVariables(ws.url);
      const validationError = validateWebSocketUrl(resolvedUrl);
      if (validationError) {
        setConnecting(false);
        setError(validationError);
        toast.warning("Validation Error", validationError, { source: "composer" });
        return;
      }
      const socket = new WebSocket(resolvedUrl, ws.protocols.length > 0 ? ws.protocols : undefined);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setConnecting(false);
        toast.success("Connected", `WebSocket connected to ${resolvedUrl}`, { source: "composer" });
        addHistoryEntry({
          id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          protocol: "websocket",
          method: "WS connect",
          target: resolvedUrl,
          timestamp: Date.now(),
          itemId: item.id,
        });
      };

      socket.onmessage = (event) => {
        const msg: WebSocketMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          direction: "received",
          data: typeof event.data === "string" ? event.data : "[Binary data]",
          timestamp: Date.now(),
          type: typeof event.data === "string" ? "text" : "binary",
        };
        setMessages((prev) => [...prev, msg]);
      };

      socket.onclose = (event) => {
        setConnected(false);
        setConnecting(false);
        socketRef.current = null;
        const reason = event.reason ? ` (${event.reason})` : "";
        toast.info("Disconnected", `WebSocket closed: ${event.code}${reason}`, { source: "composer" });

        // Auto-reconnect handled by effect below
      };

      socket.onerror = () => {
        setConnecting(false);
        setError("Connection failed. Check the URL and try again.");
        toast.error("Connection Error", "Failed to connect to WebSocket server.", { source: "composer" });
      };
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : "Failed to connect");
    }
  }, [ws, connected, connecting, toast, addHistoryEntry, item.id]);

  const handleDisconnect = useCallback(() => {
    socketRef.current?.close(1000, "User disconnected");
    socketRef.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  const handleSend = useCallback(() => {
    if (!socketRef.current || !connected || !messageInput.trim()) return;
    const data = interpolateVariables(messageInput);
    socketRef.current.send(data);
    const msg: WebSocketMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      direction: "sent",
      data,
      timestamp: Date.now(),
      type: "text",
    };
    setMessages((prev) => [...prev, msg]);
    setMessageInput("");
  }, [connected, messageInput]);

  const handleCopyMessages = useCallback(() => {
    const text = messages.map((m) => `[${m.direction}] ${new Date(m.timestamp).toLocaleTimeString()}: ${m.data}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [messages]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Error banner */}
      {error && (
        <div className="flex-shrink-0 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 flex items-center gap-3 mx-4 mt-2">
          <AlertCircle className="size-4 text-destructive shrink-0" />
          <span className="text-sm text-destructive flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0">
            <X className="size-4 text-destructive/60 hover:text-destructive transition-smooth" />
          </button>
        </div>
      )}

      {/* URL bar + connect */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <Badge
          variant={connected ? "default" : "secondary"}
          className={cn("shrink-0 text-2xs px-2", connected ? "bg-success/20 text-success border-success/30" : "")}
        >
          {connected ? "Connected" : connecting ? "Connecting…" : "Disconnected"}
        </Badge>
        <Input
          value={ws.url}
          onChange={(e) => setData({ url: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !connected && handleConnect()}
          placeholder="wss://example.com/ws"
          className="font-mono flex-1 h-9 min-w-0"
          disabled={connected}
        />
        {connected ? (
          <Button variant="destructive" size="sm" onClick={handleDisconnect} className="h-9 px-4 gap-1.5 shrink-0">
            Disconnect
          </Button>
        ) : (
          <Button onClick={handleConnect} disabled={connecting || !ws.url.trim()} className="h-9 px-5 gap-2 shrink-0">
            <Zap className="size-4" />
            Connect
          </Button>
        )}
      </div>

      {/* Options bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 shrink-0">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={ws.autoReconnect}
            onChange={(e) => setData({ autoReconnect: e.target.checked })}
            className="rounded"
          />
          Auto-reconnect
        </label>
        <div className="flex-1" />
        {messages.length > 0 && (
          <>
            <button type="button" onClick={handleCopyMessages} className="text-xs text-muted-foreground hover:text-foreground transition-smooth flex items-center gap-1">
              {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy Log"}
            </button>
            <button
              type="button"
              onClick={() => setMessages([])}
              className="text-xs text-muted-foreground hover:text-destructive transition-smooth flex items-center gap-1"
            >
              <Trash2 className="size-3" />
              Clear
            </button>
          </>
        )}
        <span className="text-2xs text-muted-foreground/60">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Message log */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
        {messages.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Zap />}
            title="No messages"
            description={connected ? "Send a message to start the conversation." : "Connect to a WebSocket server to begin."}
          />
        ) : (
          <div className="space-y-1.5">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-mono",
                  msg.direction === "sent"
                    ? "bg-primary/5 border border-primary/10"
                    : "bg-muted/30 shadow-card"
                )}
              >
                <span className="shrink-0 mt-0.5">
                  {msg.direction === "sent" ? (
                    <ArrowUpFromLine className="size-3 text-primary/70" />
                  ) : (
                    <ArrowDownToLine className="size-3 text-success/70" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <pre className="whitespace-pre-wrap break-words text-xs">{formatMessageData(msg.data)}</pre>
                </div>
                <span className="text-2xs text-muted-foreground/60 shrink-0 tabular-nums">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Message input */}
      <div className="flex-shrink-0 border-t border-border/50 px-4 py-3 flex items-end gap-2">
        <Textarea
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={connected ? 'Type a message… (Enter to send, Shift+Enter for newline)' : 'Connect first to send messages'}
          className="font-mono text-sm min-h-[40px] max-h-[120px] resize-none"
          disabled={!connected}
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!connected || !messageInput.trim()}
          className="h-10 px-4 gap-1.5 shrink-0"
        >
          <Send className="size-4" />
          Send
        </Button>
      </div>
    </div>
  );
}

function formatMessageData(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}
