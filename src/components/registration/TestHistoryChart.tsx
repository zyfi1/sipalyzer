import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

export interface TestHistoryDataPoint {
  timestamp: string;
  success: boolean;
  responseTimeMs: number;
  testType: string;
}

interface TestHistoryChartProps {
  data: TestHistoryDataPoint[];
  title?: string;
}

export function TestHistoryChart({ data, title = "Test History" }: TestHistoryChartProps) {
  const chartData = useMemo(() => {
    // Group by date and calculate averages
    const grouped = data.reduce((acc, point) => {
      const date = new Date(point.timestamp).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = {
          date,
          successCount: 0,
          totalCount: 0,
          avgResponseTime: 0,
          responseTimes: [] as number[],
        };
      }
      acc[date].totalCount++;
      if (point.success) {
        acc[date].successCount++;
      }
      acc[date].responseTimes.push(point.responseTimeMs);
      return acc;
    }, {} as Record<string, { date: string; successCount: number; totalCount: number; avgResponseTime: number; responseTimes: number[] }>);

    return Object.values(grouped).map((group) => ({
      date: group.date,
      successRate: (group.successCount / group.totalCount) * 100,
      avgResponseTime: group.responseTimes.reduce((a, b) => a + b, 0) / group.responseTimes.length,
    }));
  }, [data]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState variant="inline" title="No test history available" />
        </CardContent>
      </Card>
    );
  }

  const maxResponseTime = Math.max(...chartData.map((d) => d.avgResponseTime), 100);
  const maxSuccessRate = 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Simple bar chart representation */}
          <div className="space-y-2">
            <p className="section-label-sm">Success Rate Over Time</p>
            <div className="h-32 flex items-end gap-1">
              {chartData.map((point, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <TooltipWrapper content={`${point.date}: ${point.successRate.toFixed(1)}%`}>
                    <div
                      className="w-full bg-success/20 border border-success/30 rounded-t transition-smooth hover:bg-success/30"
                      style={{
                        height: `${(point.successRate / maxSuccessRate) * 100}%`,
                        minHeight: "4px",
                      }}
                    />
                  </TooltipWrapper>
                  <span className="text-xs text-muted-foreground rotate-45 origin-top-left whitespace-nowrap">
                    {new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t">
            <p className="section-label-sm">Average Response Time</p>
            <div className="h-32 flex items-end gap-1">
              {chartData.map((point, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <TooltipWrapper content={`${point.date}: ${point.avgResponseTime.toFixed(0)}ms`}>
                    <div
                      className="w-full bg-info/20 border border-info/30 rounded-t transition-smooth hover:bg-info/30"
                      style={{
                        height: `${(point.avgResponseTime / maxResponseTime) * 100}%`,
                        minHeight: "4px",
                      }}
                    />
                  </TooltipWrapper>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t text-sm">
            <div>
              <p className="text-muted-foreground">Total Tests</p>
              <p className="text-lg font-semibold">{data.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Success Rate</p>
              <p className="text-lg font-semibold">
                {((data.filter((d) => d.success).length / data.length) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
