/**
 * Global packet viewer modal that can be opened from anywhere in the app.
 * 
 * Place this component once at the app root level. It listens to the
 * useOpenCaptureStore and renders the PacketViewerModal when requested.
 */

import { useOpenCaptureModal } from "@/hooks/useOpenCapture";
import PacketViewerModal from "./PacketViewerModal";

export function GlobalPacketViewerModal() {
  const { sessionId, session, options, isOpen, close } = useOpenCaptureModal();

  if (!sessionId) {
    return null;
  }

  return (
    <PacketViewerModal
      sessionId={sessionId}
      session={session || undefined}
      open={isOpen}
      onClose={close}
      initialFilter={options.filter}
      highlightPacketId={options.highlightPacketId}
    />
  );
}

export default GlobalPacketViewerModal;
