import { useEffect } from "react";
import { listen } from "@/lib/tauriEvents";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RemoteChatState, RemoteChatMessage } from "@/api/remoteAgent";
import { RemoteChatPanel } from "@/components/remote-agent/RemoteChatPanel";
import { useRemoteChatStore } from "@/stores/remoteChatStore";

export function RemoteChatWindow() {
  const applyServerState = useRemoteChatStore((s) => s.applyServerState);
  const appendMessage = useRemoteChatStore((s) => s.appendMessage);
  const hydrate = useRemoteChatStore((s) => s.hydrate);

  useEffect(() => {
    hydrate().catch(() => {});
    const unlistenState = listen<RemoteChatState>("remote-chat:state", (event) => {
      applyServerState(event.payload);
    });
    const unlistenMessage = listen<RemoteChatMessage>("remote-chat:message", (event) => {
      appendMessage(event.payload);
    });
    return () => {
      unlistenState.then((fn) => fn());
      unlistenMessage.then((fn) => fn());
    };
  }, [applyServerState, appendMessage, hydrate]);

  useEffect(() => {
    const win = getCurrentWindow();
    win.setAlwaysOnTop(true).catch(() => {});
  }, []);

  return (
    <div className="h-screen w-screen bg-sidebar p-2">
      <RemoteChatPanel compact active />
    </div>
  );
}

