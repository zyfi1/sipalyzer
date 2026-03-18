/**
 * Active fax card showing fax send in progress.
 * Displays target, status, and page count.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Printer, ExternalLink, Loader2 } from "@/lib/icons";
import type { SentFaxJob } from "@/types/fax";
import { navigateTo } from "@/lib/navigation";
import {
  ACTIVITY_CARD_ACTIONS_CLASS,
  ACTIVITY_CARD_BODY_CLASS,
  ACTIVITY_CARD_CLASS,
  ACTIVITY_CARD_CONTENT_CLASS,
  ACTIVITY_CARD_HEADER_CLASS,
  ACTIVITY_CARD_ICON_PING_CLASS,
  ACTIVITY_CARD_ICON_SHELL_CLASS,
  ACTIVITY_CARD_STATS_ROW_CLASS,
  ACTIVITY_CARD_STATUS_LABEL_CLASS,
} from "./activityCardShell";

interface ActiveFaxCardProps {
  job: SentFaxJob;
  onNavigate: () => void;
}

function getStatusLabel(status: SentFaxJob["status"]): string {
  switch (status) {
    case "pending": return "Preparing...";
    case "sending": return "Sending...";
    case "sent": return "Sent";
    case "failed": return "Failed";
    default: return status;
  }
}

export function ActiveFaxCard({ job, onNavigate }: ActiveFaxCardProps) {
  const handleOpen = () => {
    navigateTo("fax-center", "in_progress");
    onNavigate();
  };

  const isSending = job.status === "pending" || job.status === "sending";

  return (
    <Card className={ACTIVITY_CARD_CLASS}>
      <CardContent className={ACTIVITY_CARD_CONTENT_CLASS}>
        <div className={ACTIVITY_CARD_HEADER_CLASS}>
          {/* Icon */}
          <div className={`${ACTIVITY_CARD_ICON_SHELL_CLASS} bg-muted/40`}>
            {isSending && (
              <span className={`${ACTIVITY_CARD_ICON_PING_CLASS} bg-foreground/30`} />
            )}
            <Printer className="relative h-5 w-5 text-foreground" />
          </div>

          <div className={ACTIVITY_CARD_BODY_CLASS}>
            <div className="flex items-center gap-2">
              <span className={`${ACTIVITY_CARD_STATUS_LABEL_CLASS} text-foreground`}>
                {getStatusLabel(job.status)}
              </span>
              {isSending && <Loader2 className="h-3 w-3 animate-spin text-foreground" />}
            </div>
            <p className="font-medium text-foreground truncate">Fax to {job.target}</p>
            
            {/* Stats row */}
            <div className={ACTIVITY_CARD_STATS_ROW_CLASS}>
              <span>{job.pageCount} page{job.pageCount !== 1 ? "s" : ""}</span>
              {job.registrarName && <span>via {job.registrarName}</span>}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className={ACTIVITY_CARD_ACTIONS_CLASS}>
          <TooltipWrapper title="Open Fax Center" description="Open the Fax Center to view send progress.">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleOpen}
              className="gap-1.5"
            >
              <ExternalLink className="h-4 w-4" />
              Open Fax Center
            </Button>
          </TooltipWrapper>
        </div>
      </CardContent>
    </Card>
  );
}
