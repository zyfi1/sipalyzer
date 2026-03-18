/**
 * Active test card showing registration test in progress.
 * Displays which registrar(s) are being tested.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Server, ExternalLink, Loader2 } from "@/lib/icons";
import { navigateTo } from "@/lib/navigation";
import {
  ACTIVITY_CARD_ACTIONS_CLASS,
  ACTIVITY_CARD_BODY_CLASS,
  ACTIVITY_CARD_CLASS,
  ACTIVITY_CARD_CONTENT_CLASS,
  ACTIVITY_CARD_HEADER_CLASS,
  ACTIVITY_CARD_ICON_PING_CLASS,
  ACTIVITY_CARD_ICON_SHELL_CLASS,
  ACTIVITY_CARD_STATUS_LABEL_CLASS,
} from "./activityCardShell";

interface ActiveTestCardProps {
  registrarNames: string[];
  isBulk: boolean;
  onNavigate: () => void;
}

export function ActiveTestCard({ registrarNames, isBulk, onNavigate }: ActiveTestCardProps) {
  const handleOpen = () => {
    navigateTo("registration");
    onNavigate();
  };

  const label = isBulk
    ? `Testing ${registrarNames.length} registrar${registrarNames.length !== 1 ? "s" : ""}...`
    : registrarNames.length > 0
    ? `Testing ${registrarNames[0]}...`
    : "Running test...";

  return (
    <Card className={ACTIVITY_CARD_CLASS}>
      <CardContent className={ACTIVITY_CARD_CONTENT_CLASS}>
        <div className={ACTIVITY_CARD_HEADER_CLASS}>
          {/* Icon */}
          <div className={`${ACTIVITY_CARD_ICON_SHELL_CLASS} bg-muted/40`}>
            <span className={`${ACTIVITY_CARD_ICON_PING_CLASS} bg-foreground/30`} />
            <Server className="relative h-5 w-5 text-foreground" />
          </div>

          <div className={ACTIVITY_CARD_BODY_CLASS}>
            <div className="flex items-center gap-2">
              <span className={`${ACTIVITY_CARD_STATUS_LABEL_CLASS} text-foreground`}>
                Registration Test
              </span>
              <Loader2 className="h-3 w-3 animate-spin text-foreground" />
            </div>
            <p className="font-medium text-foreground">{label}</p>
            
            {/* Show registrar names if multiple */}
            {registrarNames.length > 1 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {registrarNames.slice(0, 5).map((name) => (
                  <span
                    key={name}
                    className="text-xs surface-subtle px-2 py-0.5 rounded-full text-muted-foreground"
                  >
                    {name}
                  </span>
                ))}
                {registrarNames.length > 5 && (
                  <span className="text-xs text-muted-foreground">
                    +{registrarNames.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className={ACTIVITY_CARD_ACTIONS_CLASS}>
          <TooltipWrapper title="Open Registration" description="Open the Registration tool to view test progress.">
            <Button
              variant="neutral"
              size="sm"
              onClick={handleOpen}
              className="gap-1.5"
            >
              <ExternalLink className="h-4 w-4" />
              Open Registration
            </Button>
          </TooltipWrapper>
        </div>
      </CardContent>
    </Card>
  );
}
