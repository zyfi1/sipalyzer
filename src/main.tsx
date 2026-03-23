import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { registerTools } from "./lib/tools";
import { setupWorkspace } from "./lib/workspaceSetup";
import { useErrorStore } from "./stores/errorStore";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

registerTools();
setupWorkspace();

// Global handlers — capture into errorStore + console.
// Noise patterns from Tauri internals / HMR are suppressed so the
// activity feed only shows errors relevant to tool functionality.
const NOISE_PATTERNS = [
  "listeners[eventId",
  "undefined is not an object (evaluating 'listeners",
  "Cannot read properties of undefined (reading 'listeners')",
  "ResizeObserver loop",
  "ResizeObserver loop completed with undelivered notifications",
  "Script error.",
];
function isNoise(msg: string): boolean {
  return NOISE_PATTERNS.some((p) => msg.includes(p));
}

window.onerror = (message, source, lineno, colno, error) => {
  const msg = typeof message === "string" ? message : String(message);
  if (isNoise(msg)) return true;
  const src = source ? `${source}:${lineno}:${colno}` : "unknown";
  useErrorStore.getState().capture(msg, src, error?.stack);
  console.error("[Unhandled error]", { message, source, lineno, colno, error });
  return false;
};
window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (isNoise(msg)) { event.preventDefault?.(); return; }
  const stack = reason instanceof Error ? reason.stack : undefined;
  useErrorStore.getState().capture(msg, "unhandledrejection", stack);
  console.error("[Unhandled promise rejection]", event.reason);
  event.preventDefault?.();
};

function dismissBootScreen(): void {
  const boot = document.getElementById("boot-screen");
  if (!boot) return;
  boot.classList.add("boot-exit");
  window.setTimeout(() => {
    boot.remove();
  }, 260);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider forcedTheme="dark" enableSystem={false} attribute="class">
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    dismissBootScreen();
  });
});
