import { useState, useEffect } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { Spinner } from "@/components/ui/spinner";

export function LoadingOverlay() {
  const bulkOperationInProgress = useRegistrationStore((s) => s.bulkOperationInProgress);
  const [showOverlay, setShowOverlay] = useState(false);

  // Only show overlay for long-running bulk operations (test suite, bulk tests).
  // Do not show for initial fetchRegistrars/loading so the home screen doesn't flash a loading overlay on app load.
  useEffect(() => {
    if (bulkOperationInProgress) {
      const timer = setTimeout(() => setShowOverlay(true), 300);
      return () => {
        clearTimeout(timer);
        setShowOverlay(false);
      };
    }
    setShowOverlay(false);
    return undefined;
  }, [bulkOperationInProgress]);

  if (!showOverlay) {
    return null;
  }

  return (
    <>
      {/* Top progress bar */}
      <div className="fixed top-0 left-0 right-0 z-[10201] pointer-events-none">
        <div className="relative h-1.5 bg-muted/30 overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full w-[40%] bg-primary shadow-lg shadow-primary/50 animate-loading-slide"
          />
        </div>
      </div>
      
      {/* Full-screen overlay with spinner - blocks all interactions */}
      <div 
        className="fixed inset-0 z-[10200] bg-background/90 flex items-center justify-center"
        style={{ pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 p-8 rounded-md bg-card border border-border/55 shadow-card transition-smooth">
          <Spinner className="size-10 text-primary" />
          <div className="text-center space-y-2">
            <p className="text-base font-semibold text-foreground">
              {bulkOperationInProgress ? "Running Tests..." : "Running Test Suite..."}
            </p>
            <p className="text-sm text-muted-foreground">
              Please wait while tests execute. The app may appear unresponsive during this time.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
