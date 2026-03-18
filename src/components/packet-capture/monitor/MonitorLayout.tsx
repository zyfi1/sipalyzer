import { useState, useRef, useEffect, memo, useMemo } from "react";
import { WarperPacketList } from "./WarperPacketList";
import { PacketDetailsView } from "./PacketDetailsView";
import type { PacketInfo } from "@/types/packetCapture";
import { Spinner } from "@/components/ui/spinner";

interface MonitorLayoutProps {
  packets: PacketInfo[];
  selectedPacketIndex: number | null;
  onSelectPacket: (index: number) => void;
  autoScroll: boolean;
  showDetails: boolean;
  panelPosition?: "left" | "right" | "bottom" | "top" | "hidden";
  /** Windowed mode: total packets in capture */
  totalPacketCount?: number | null;
  /** Windowed mode: start index of current window */
  windowStart?: number;
  /** Windowed mode: load window at offset */
  onRequestWindow?: (offset: number) => void;
  /** Show loading indicator when true */
  isLoading?: boolean;
}

export const MonitorLayout = memo(function MonitorLayout({
  packets,
  selectedPacketIndex,
  onSelectPacket,
  autoScroll,
  showDetails,
  panelPosition = "right",
  totalPacketCount,
  windowStart = 0,
  onRequestWindow,
  isLoading = false,
}: MonitorLayoutProps) {
  // Props for Warper high-performance list
  const warperListProps = useMemo(
    () => ({
      packets,
      selectedIndex: selectedPacketIndex,
      onSelect: onSelectPacket,
      autoScroll,
      totalCount: totalPacketCount || undefined,
      windowOffset: windowStart,
      onRequestWindow,
    }),
    [packets, selectedPacketIndex, onSelectPacket, autoScroll, totalPacketCount, windowStart, onRequestWindow]
  );

  // Render the Warper packet list (high-performance, 120 FPS)
  const renderPacketList = () => {
    return <WarperPacketList {...warperListProps} className="flex-1" />;
  };
  const [leftWidth, setLeftWidth] = useState(75);
  const [topHeight, setTopHeight] = useState(60);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<"horizontal" | "vertical">("horizontal");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedPacket = selectedPacketIndex !== null ? packets[selectedPacketIndex] : null;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      if (resizeDirection === "horizontal") {
        const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        setLeftWidth(Math.max(30, Math.min(85, newLeftWidth)));
      } else {
        const newTopHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;
        setTopHeight(Math.max(30, Math.min(85, newTopHeight)));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing, resizeDirection]);

  const renderLayout = () => {
    if (!showDetails || panelPosition === "hidden") {
      return (
        <div ref={containerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {renderPacketList()}
        </div>
      );
    }

    // Render based on panel position
    switch (panelPosition) {
      case "left":
        return (
          <div ref={containerRef} className="flex relative flex-1 min-h-0 overflow-hidden">
            <div 
              className="flex-shrink-0" 
              style={{ 
                width: `${100 - leftWidth}%`, 
                display: "flex", 
                flexDirection: "column",
                minHeight: "600px"
              }}
            >
              <div style={{ height: "600px", overflowY: "auto" }}>
                <PacketDetailsView packet={selectedPacket ?? null} />
              </div>
            </div>
            <div
              className="w-1 border-x border-border/20 bg-muted/30 cursor-col-resize hover:bg-foreground/25 transition-smooth flex-shrink-0"
              onMouseDown={() => {
                setResizeDirection("horizontal");
                setIsResizing(true);
              }}
            />
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ width: `${leftWidth}%` }}>
              {renderPacketList()}
            </div>
          </div>
        );

      case "right":
        return (
          <div ref={containerRef} className="flex relative flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ width: `${leftWidth}%` }}>
              {renderPacketList()}
            </div>
            <div
              className="w-1 border-x border-border/20 bg-muted/30 cursor-col-resize hover:bg-foreground/25 transition-smooth flex-shrink-0"
              onMouseDown={() => {
                setResizeDirection("horizontal");
                setIsResizing(true);
              }}
            />
            <div 
              className="flex-shrink-0" 
              style={{ 
                width: `${100 - leftWidth}%`, 
                display: "flex", 
                flexDirection: "column",
                minHeight: "600px"
              }}
            >
              <div style={{ height: "600px", overflowY: "auto" }}>
                <PacketDetailsView packet={selectedPacket ?? null} />
              </div>
            </div>
          </div>
        );

      case "bottom":
        return (
          <div ref={containerRef} className="flex flex-col relative flex-1 min-h-0 overflow-hidden">
            <div className="min-h-0 overflow-hidden flex flex-col flex-1" style={{ minHeight: "300px" }}>
              {renderPacketList()}
            </div>
            <div
              className="h-1 border-y border-border/20 bg-muted/30 cursor-row-resize hover:bg-foreground/25 transition-smooth flex-shrink-0"
              onMouseDown={() => {
                setResizeDirection("vertical");
                setIsResizing(true);
              }}
            />
            <div
              className="flex-shrink-0"
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: "300px"
              }}
            >
              <div style={{ height: `${(100 - topHeight) * 6}px`, overflowY: "auto" }}>
                <PacketDetailsView packet={selectedPacket ?? null} />
              </div>
            </div>
          </div>
        );

      case "top":
        return (
          <div ref={containerRef} className="flex flex-col relative flex-1 min-h-0 overflow-hidden">
            <div 
              className="flex-shrink-0 z-10" 
              style={{ 
                display: "flex", 
                flexDirection: "column",
                minHeight: "300px"
              }}
            >
              <div style={{ height: `${(100 - topHeight) * 6}px`, overflowY: "auto" }}>
                <PacketDetailsView packet={selectedPacket ?? null} />
              </div>
            </div>
            <div
              className="h-1 border-y border-border/20 bg-muted/30 cursor-row-resize hover:bg-foreground/25 transition-smooth flex-shrink-0"
              onMouseDown={() => {
                setResizeDirection("vertical");
                setIsResizing(true);
              }}
            />
            <div className="min-h-0 overflow-hidden flex flex-col flex-1" style={{ minHeight: "300px" }}>
              {renderPacketList()}
            </div>
          </div>
        );

      default:
        return (
          <div ref={containerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {renderPacketList()}
          </div>
        );
    }
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {renderLayout()}
      {isLoading && (
        <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span className="text-sm">Loading packets...</span>
          </div>
        </div>
      )}
    </div>
  );
});
