import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { Minus, X, MaximizeScreen, MinimizeScreen } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

/**
 * Unified custom window controls — works on macOS, Windows, and Linux.
 * Uses explicit maximize/unmaximize instead of toggleMaximize for reliability,
 * and listens to resize events so the icon always reflects the real window state.
 */
export function WindowControls() {
  const winRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);
  const [maximized, setMaximized] = useState(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  if (!winRef.current) {
    try {
      winRef.current = getCurrentWindow();
    } catch {
      // Tauri runtime not available (e.g. during dev in a regular browser)
    }
  }

  /** Poll the actual maximized state from the window manager */
  const syncState = useCallback(async () => {
    try {
      const m = await winRef.current?.isMaximized();
      setMaximized(!!m);
    } catch {
      /* permission or timing error — ignore */
    }
  }, []);

  const close = useCallback(() => { winRef.current?.close(); }, []);
  const minimize = useCallback(() => { winRef.current?.minimize(); }, []);

  const toggleMaximize = useCallback(async () => {
    const win = winRef.current;
    if (!win) return;
    try {
      const isMax = await win.isMaximized();
      if (isMax) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch {
      await win.toggleMaximize();
    }
    setTimeout(syncState, 200);
  }, [syncState]);

  // ─── Reactive state sync via onResized ─────────────────────────────────────
  useEffect(() => {
    const win = winRef.current;
    if (!win) return;

    syncState();

    let unlisten: (() => void) | undefined;
    win
      .onResized(() => {
        setTimeout(syncState, 60);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [syncState]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const btn = cn(
    "h-8 w-9 inline-flex items-center justify-center rounded-lg text-muted-foreground",
    "transition-smooth ui-hover-press motion-reduce:transform-none",
    "outline-none focus-visible:shadow-focus"
  );

  // On macOS we use native traffic-light controls from the titlebar.
  if (isMac) return null;

  return (
    <div className="flex items-center gap-0.5 ml-1.5">
      {/* Minimize */}
      <TooltipWrapper title="Minimize" description="Minimize the window to the taskbar.">
        <button
          type="button"
          onClick={minimize}
          className={cn(btn, "hover:bg-muted/50 hover:text-foreground")}
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </TooltipWrapper>

      {/* Maximize / Restore */}
      <TooltipWrapper
        title={maximized ? "Restore" : "Maximize"}
        description={maximized ? "Restore the window to its previous size." : "Maximize the window to fill the screen."}
      >
        <button
          type="button"
          onClick={toggleMaximize}
          className={cn(btn, "hover:bg-muted/50 hover:text-foreground")}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
        {maximized ? (
          <MinimizeScreen className="h-3.5 w-3.5" />
        ) : (
          <MaximizeScreen className="h-3.5 w-3.5" />
        )}
        </button>
      </TooltipWrapper>

      {/* Close */}
      <TooltipWrapper title="Close" description="Close the application window.">
        <button
          type="button"
          onClick={close}
          className={cn(btn, "hover:bg-destructive/15 hover:text-destructive")}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </TooltipWrapper>
    </div>
  );
}

