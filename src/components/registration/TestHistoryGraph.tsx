import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime, formatDate } from "@/lib/dateTime";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

export interface TimeSeriesDataPoint {
  period: string;
  success_rate: number;
  avg_response_time: number;
}

interface TestHistoryGraphProps {
  data: TimeSeriesDataPoint[];
  title?: string;
}

export function TestHistoryGraph({ data, title = "Test History" }: TestHistoryGraphProps) {
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d" | "all">("7d");

  const filteredData = useMemo(() => {
    if (timeRange === "all") return data;
    
    const cutoff = new Date();
    switch (timeRange) {
      case "24h":
        cutoff.setHours(cutoff.getHours() - 24);
        break;
      case "7d":
        cutoff.setDate(cutoff.getDate() - 7);
        break;
      case "30d":
        cutoff.setDate(cutoff.getDate() - 30);
        break;
    }
    
    return data.filter(point => {
      try {
        const pointDate = new Date(point.period);
        return pointDate >= cutoff;
      } catch {
        return false;
      }
    });
  }, [data, timeRange]);

  if (filteredData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState compact variant="inline" title="No data available" description="Select a different time range." />
        </CardContent>
      </Card>
    );
  }

  const maxResponseTime = Math.max(...filteredData.map((d) => d.avg_response_time), 100);
  const maxSuccessRate = 100;

  const formatPeriod = (period: string) => {
    try {
      if (timeRange === "24h") return formatTime(period);
      return formatDate(period);
    } catch {
      return period;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
          <div className="flex gap-1">
            {(["24h", "7d", "30d", "all"] as const).map((range) => (
              <TooltipWrapper
                key={range}
                title={range === "all" ? "All time" : range === "24h" ? "Last 24 hours" : range === "7d" ? "Last 7 days" : "Last 30 days"}
                description={range === "all" ? "Show all data points." : `Filter to ${range === "24h" ? "the last 24 hours" : range === "7d" ? "the last 7 days" : "the last 30 days"}.`}
              >
                <Button
                  variant={timeRange === range ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setTimeRange(range)}
                  className="h-7 text-xs"
                >
                  {range === "all" ? "All" : range.toUpperCase()}
                </Button>
              </TooltipWrapper>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Success Rate Trend */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Success Rate Trend</p>
            <div className="h-40 flex items-end gap-1.5">
              {filteredData.map((point, idx) => {
                const height = (point.success_rate / maxSuccessRate) * 100;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 group">
                    <TooltipWrapper content={`${formatPeriod(point.period)}: ${(point.success_rate * 100).toFixed(1)}%`}>
                      <div
                        className={cn(
                          "w-full rounded-t transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)] relative",
                          "bg-gradient-to-t from-success/40 to-success/20",
                          "border border-success/30 hover:from-success/60 hover:to-success/40",
                          "hover:shadow-lg hover:shadow-success/20"
                        )}
                        style={{
                          height: `${height}%`,
                          minHeight: "4px",
                        }}
                      />
                    </TooltipWrapper>
                    {idx % Math.ceil(filteredData.length / 8) === 0 && (
                      <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatPeriod(point.period)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Response Time Trend */}
          <div className="space-y-3 pt-4 border-t">
            <p className="text-sm font-semibold">Response Time Trend</p>
            <div className="h-40 flex items-end gap-1.5">
              {filteredData.map((point, idx) => {
                const height = (point.avg_response_time / maxResponseTime) * 100;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 group">
                    <TooltipWrapper content={`${formatPeriod(point.period)}: ${point.avg_response_time.toFixed(0)}ms`}>
                      <div
                        className={cn(
                          "w-full rounded-t transition-all duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]",
                          "bg-gradient-to-t from-primary/40 to-primary/20",
                          "border border-primary/30 hover:from-primary/60 hover:to-primary/40",
                          "hover:shadow-lg hover:shadow-primary/20"
                        )}
                        style={{
                          height: `${height}%`,
                          minHeight: "4px",
                        }}
                      />
                    </TooltipWrapper>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
