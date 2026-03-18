import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface MetricSparklineProps {
  data: { timestamp_unix_ms: number; value: number }[];
  width?: number;
  height?: number;
  color?: string;
  thresholdValue?: number;
  thresholdColor?: string;
  className?: string;
}

export function MetricSparkline({
  data,
  width = 120,
  height = 28,
  color = "currentColor",
  thresholdValue,
  thresholdColor = "var(--color-destructive)",
  className,
}: MetricSparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return "";

    const values = data.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const padding = 2;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    const points = data.map((d, i) => {
      const x = padding + (i / (data.length - 1)) * drawWidth;
      const y = padding + drawHeight - ((d.value - minVal) / range) * drawHeight;
      return `${x},${y}`;
    });

    return `M${points.join(" L")}`;
  }, [data, width, height]);

  const thresholdY = useMemo(() => {
    if (thresholdValue === undefined || data.length < 2) return null;
    const values = data.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const padding = 2;
    const drawHeight = height - padding * 2;
    return padding + drawHeight - ((thresholdValue - minVal) / range) * drawHeight;
  }, [data, thresholdValue, height]);

  if (data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-muted-foreground/40 text-[9px]", className)}
        style={{ width, height }}
      >
        --
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
    >
      {thresholdY !== null && (
        <line
          x1={2}
          y1={thresholdY}
          x2={width - 2}
          y2={thresholdY}
          stroke={thresholdColor}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.5}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
