import { useEffect, useRef, useState, type ReactNode } from "react";
import { PacketDetailsView } from "@/components/packet-capture/monitor/PacketDetailsView";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { X } from "@/lib/icons";
import type { PacketInfo } from "@/types/packetCapture";

interface PacketDetailsPopoutProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packet: PacketInfo | null;
  sessionId: string | null;
  packetIndex: number | null;
  initialTab?: "overview" | "protocol" | "raw";
  children?: ReactNode;
}

export function PacketDetailsPopout({
  open,
  onOpenChange,
  packet,
  sessionId,
  packetIndex,
  initialTab,
  children,
}: PacketDetailsPopoutProps) {
  const [position, setPosition] = useState({ x: 120, y: 90 });
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (e: PointerEvent) => {
      const nextX = Math.max(8, e.clientX - dragOffsetRef.current.x);
      const nextY = Math.max(44, e.clientY - dragOffsetRef.current.y);
      setPosition({ x: nextX, y: nextY });
    };
    const onPointerUp = () => setDragging(false);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10020] pointer-events-none">
      <button
        type="button"
        aria-label="Close popout"
        className="absolute inset-0 pointer-events-auto bg-black/10"
        onClick={() => onOpenChange(false)}
      />
      <div
        className="packet-graphite-panel pointer-events-auto fixed flex flex-col overflow-hidden"
        style={{
          left: position.x,
          top: position.y,
          width: "min(95vw, 1200px)",
          height: "85vh",
        }}
      >
        <div
          className="ui-section-header-sm flex h-8 shrink-0 cursor-move items-center justify-between px-2"
          onPointerDown={(e) => {
            const rect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
            dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            setDragging(true);
          }}
        >
          <span className="text-2xs text-muted-foreground/70">Drag</span>
          <Button
            size="icon-sm"
            variant="neutral"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {children ? (
            children
          ) : packet && sessionId ? (
            <PacketDetailsView
              packet={packet}
              sessionId={sessionId}
              packetIndex={packetIndex}
              initialTab={initialTab}
            />
          ) : (
            <EmptyState
              variant="inline"
              title="No packet selected"
              description="Select a packet row to inspect it in the popout."
              className="h-full p-6"
            />
          )}
        </div>
      </div>
    </div>
  );
}

