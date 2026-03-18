/**
 * Safe wrapper around Tauri's event system.
 *
 * The raw `listen()` / unlisten flow from @tauri-apps/api can throw
 * "undefined is not an object (evaluating 'listeners[eventId]')" when:
 *  - The webview's internal listener map isn't initialised yet (early startup).
 *  - HMR unmounts a component while listen() is still resolving.
 *  - A version mismatch between the JS API and the Rust crate causes
 *    structural differences in the event bridge.
 *
 * `safeListen` swallows those infrastructure errors so they don't pollute
 * the console, while still forwarding genuine listener callbacks.
 */

import { listen as tauriListen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type { UnlistenFn } from "@tauri-apps/api/event";

export function listen<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return tauriListen<T>(event, handler).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("listeners") ||
      msg.includes("eventId") ||
      msg.includes("undefined is not an object")
    ) {
      // Known Tauri event-bridge timing issue — safe to ignore.
      // Return a no-op unlisten so callers don't break.
      return () => {};
    }
    throw err;
  });
}
