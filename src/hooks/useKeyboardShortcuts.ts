import { useEffect } from "react";

interface KeyboardShortcuts {
  [key: string]: (e: KeyboardEvent) => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      // Build shortcut string
      const parts: string[] = [];
      if (ctrl) parts.push("ctrl");
      if (shift) parts.push("shift");
      if (alt) parts.push("alt");
      parts.push(key);

      const shortcut = parts.join("+");

      if (shortcuts[shortcut]) {
        e.preventDefault();
        shortcuts[shortcut](e);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
