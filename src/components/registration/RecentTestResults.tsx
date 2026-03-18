import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TEST_TYPES } from "@/types/registration";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

export interface RecentTestResult {
  timestamp: string;
  registrar_id: string;
  registrar_name: string;
  test_type: string;
  status: "pass" | "fail";
  response_time_ms: number;
}

interface RecentTestResultsProps {
  results: RecentTestResult[];
  onResultClick?: (result: RecentTestResult) => void;
  maxResults?: number;
}

export function RecentTestResults({ results, onResultClick, maxResults = 20 }: RecentTestResultsProps) {
  const displayResults = useMemo(() => {
    return [...results]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, maxResults);
  }, [results, maxResults]);

  const getTestTypeLabel = (testTypeId: string) => {
    return TEST_TYPES.find(t => t.id === testTypeId)?.label || testTypeId;
  };

  const formatTimeAgo = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return "Unknown";
    }
  };

  const formatExactTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const responseTimeHint = (ms: number) => {
    if (ms <= 0) return "No timing captured";
    if (ms < 100) return "Fast";
    if (ms < 300) return "Moderate";
    return "Slow";
  };

  if (displayResults.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">Recent Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState variant="inline" title="No recent test results" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">Recent Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {displayResults.map((result, idx) => (
              <TooltipWrapper key={idx} title="View result" description="Click to view or filter by this result.">
              <div
                onClick={() => onResultClick?.(result)}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg border transition-smooth shadow-card hover-lift cursor-pointer",
                  "hover:bg-accent/5 hover:border-border",
                  result.status === "pass" ? "border-success/20 bg-success/5" :
                  "border-destructive/20 bg-destructive/5"
                )}
              >
                <div className="flex-shrink-0">
                  {result.status === "pass" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold truncate">{result.registrar_name}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-2xs font-semibold",
                        result.status === "pass"
                          ? "bg-success/20 text-success border-success/30"
                          : "bg-destructive/20 text-destructive border-destructive/30",
                      )}
                    >
                      {result.status === "pass" ? "Passed" : "Failed"}
                    </Badge>
                    <Badge 
                      variant="outline"
                      className="text-xs font-medium bg-muted/40 text-foreground/80 border-border/50"
                    >
                      {getTestTypeLabel(result.test_type)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span title={formatExactTime(result.timestamp)}>{formatTimeAgo(result.timestamp)}</span>
                    </div>
                    <span className="tabular-nums">
                      {result.response_time_ms > 0 ? `${result.response_time_ms}ms` : "—"}
                    </span>
                    <span>{responseTimeHint(result.response_time_ms)}</span>
                  </div>
                </div>
              </div>
              </TooltipWrapper>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
