import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import type { UserAgentScope } from "@/stores/settingsStore";

export type HeaderEntry = { key: string; value: string };

export function hasHeader(headers: HeaderEntry[], name: string): boolean {
  return headers.some((h) => h.key.toLowerCase() === name.toLowerCase());
}

export function upsertHeader(headers: HeaderEntry[], key: string, value: string): void {
  const idx = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
  if (idx === -1) headers.push({ key, value });
  else headers[idx] = { key: headers[idx]?.key ?? key, value };
}

export function removeHeader(headers: HeaderEntry[], key: string): void {
  const idx = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
  if (idx !== -1) headers.splice(idx, 1);
}

export function useComposerUserAgent(scope: UserAgentScope): string {
  const getEffectiveUserAgentForScope = useSettingsStore((s) => s.getEffectiveUserAgentForScope);
  const [defaultUserAgent, setDefaultUserAgent] = useState("SIPalyzer/1.0");

  useEffect(() => {
    let cancelled = false;
    getEffectiveUserAgentForScope(scope)
      .then((ua) => {
        if (!cancelled) setDefaultUserAgent(ua || "SIPalyzer/1.0");
      })
      .catch(() => {
        if (!cancelled) setDefaultUserAgent("SIPalyzer/1.0");
      });
    return () => {
      cancelled = true;
    };
  }, [getEffectiveUserAgentForScope, scope]);

  return defaultUserAgent;
}

export function useComposerSplitPane(
  initialSplitPercent: number,
  onCommit: (splitPercent: number) => void,
): {
  splitRef: RefObject<HTMLDivElement>;
  splitPercent: number;
  handleDragStart: (e: ReactMouseEvent) => void;
} {
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitPercent, setSplitPercent] = useState(initialSplitPercent);
  const isDragging = useRef(false);

  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = Math.min(75, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
      setSplitPercent(pct);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(splitPercent);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [onCommit, splitPercent]);

  return { splitRef, splitPercent, handleDragStart };
}
