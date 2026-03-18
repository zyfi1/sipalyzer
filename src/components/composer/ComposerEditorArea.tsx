/**
 * Composer editor area — renders the active tab's editor.
 * SSH items are handled in the SSH subview, not here.
 * Empty state is handled by the guided landing page in ComposerTool.
 */

import { useComposerStore } from "@/stores/composerStore";
import { HttpRequestEditor } from "./editors/HttpRequestEditor";
import { SipRequestEditor } from "./editors/SipRequestEditor";
import { WebSocketEditor } from "./editors/WebSocketEditor";
import { GraphqlEditor } from "./editors/GraphqlEditor";

export function ComposerEditorArea() {
  const activeTabId = useComposerStore((s) => s.activeTabId);
  const items = useComposerStore((s) => s.collections.items);

  const activeItem = activeTabId
    ? items.find((i) => i.id === activeTabId)
    : null;

  if (!activeItem) return null;

  switch (activeItem.protocol) {
    case "http":
      return <HttpRequestEditor item={activeItem} />;
    case "sip":
      return <SipRequestEditor item={activeItem} />;
    case "websocket":
      return <WebSocketEditor item={activeItem} />;
    case "graphql":
      return <GraphqlEditor item={activeItem} />;
    default:
      return null;
  }
}
