import { useSoftphoneStore, CODEC_OPTIONS } from "@/stores/softphoneStore";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Phone,
  PhoneOff,
  ArrowRightLeft,
  ChevronUp,
  ChevronDown,
  X,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { SOFTPHONE } from "./softphone-constants";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

export function PhoneQuickSettings() {
  const dndEnabled = useSoftphoneStore((s) => s.dndEnabled);
  const forwardAllEnabled = useSoftphoneStore((s) => s.forwardAllEnabled);
  const forwardAllTarget = useSoftphoneStore((s) => s.forwardAllTarget);
  const forwardBusyEnabled = useSoftphoneStore((s) => s.forwardBusyEnabled);
  const forwardBusyTarget = useSoftphoneStore((s) => s.forwardBusyTarget);
  const forwardNoAnswerEnabled = useSoftphoneStore((s) => s.forwardNoAnswerEnabled);
  const forwardNoAnswerTarget = useSoftphoneStore((s) => s.forwardNoAnswerTarget);
  const preferredCodecs = useSoftphoneStore((s) => s.preferredCodecs);
  const setPreferredCodecs = useSoftphoneStore((s) => s.setPreferredCodecs);
  const updateSettings = useSoftphoneStore((s) => s.updateSettings);

  return (
    <div className="px-5 pb-5 space-y-3">
      {/* Divider */}
      <div className="border-t border-border/20" />

      {/* ── DND + Forwarding row ── */}
      <div className="space-y-2">
        <p className={cn(SOFTPHONE.sectionHeader)}>
          Call Routing
        </p>

        {/* DND */}
        <label
          htmlFor="qs-dnd"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-smooth",
            dndEnabled
              ? "border-destructive/25 bg-destructive/5"
              : "rounded-md border border-border/40 bg-card/50 hover:bg-card/80",
          )}
        >
          <span className={cn(
            "h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-smooth",
            dndEnabled ? "bg-destructive/15" : "bg-muted/30",
          )}>
            {dndEnabled ? (
              <PhoneOff className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <Phone className="h-3.5 w-3.5 text-success/70" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-foreground">Do not disturb</span>
          </div>
          <Checkbox
            id="qs-dnd"
            checked={dndEnabled}
            onCheckedChange={(v) => updateSettings({ dndEnabled: v === true })}
          />
        </label>

        {/* Forwarding rows */}
        <div className="ui-panel-shell divide-y divide-border/20">
          {/* Forward all */}
          <div className="px-3 py-2 space-y-1.5">
            <label htmlFor="qs-fwd-all" className="flex items-center gap-2.5 cursor-pointer">
              <ArrowRightLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <span className="text-xs text-foreground flex-1">Forward all</span>
              <Checkbox
                id="qs-fwd-all"
                checked={forwardAllEnabled}
                onCheckedChange={(v) => updateSettings({ forwardAllEnabled: v === true })}
              />
            </label>
            {forwardAllEnabled && (
              <Input
                placeholder="sip:user@host or number"
                value={forwardAllTarget}
                onChange={(e) => updateSettings({ forwardAllTarget: e.target.value })}
                className="h-7 text-2xs rounded-lg border-border/20 bg-background/50 ml-5"
              />
            )}
          </div>
          {/* Forward busy */}
          <div className="px-3 py-2 space-y-1.5">
            <label htmlFor="qs-fwd-busy" className="flex items-center gap-2.5 cursor-pointer">
              <ArrowRightLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <span className="text-xs text-foreground flex-1">Forward on busy</span>
              <Checkbox
                id="qs-fwd-busy"
                checked={forwardBusyEnabled}
                onCheckedChange={(v) => updateSettings({ forwardBusyEnabled: v === true })}
              />
            </label>
            {forwardBusyEnabled && (
              <Input
                placeholder="sip:user@host or number"
                value={forwardBusyTarget}
                onChange={(e) => updateSettings({ forwardBusyTarget: e.target.value })}
                className="h-7 text-2xs rounded-lg border-border/20 bg-background/50 ml-5"
              />
            )}
          </div>
          {/* Forward no answer */}
          <div className="px-3 py-2 space-y-1.5">
            <label htmlFor="qs-fwd-na" className="flex items-center gap-2.5 cursor-pointer">
              <ArrowRightLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <span className="text-xs text-foreground flex-1">Forward no answer</span>
              <Checkbox
                id="qs-fwd-na"
                checked={forwardNoAnswerEnabled}
                onCheckedChange={(v) => updateSettings({ forwardNoAnswerEnabled: v === true })}
              />
            </label>
            {forwardNoAnswerEnabled && (
              <Input
                placeholder="sip:user@host or number"
                value={forwardNoAnswerTarget}
                onChange={(e) => updateSettings({ forwardNoAnswerTarget: e.target.value })}
                className="h-7 text-2xs rounded-lg border-border/20 bg-background/50 ml-5"
              />
            )}
          </div>
        </div>
      </div>


      {/* ── Codec preference ── */}
      <div className="space-y-2">
        <p className={cn(SOFTPHONE.sectionHeader)}>
          Codec Preference
        </p>
        <div className="ui-panel-shell">
          <div className="px-3 py-2 space-y-0.5">
            {preferredCodecs.map((codec, index) => (
              <div
                key={codec}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-accent/30 group transition-smooth"
              >
                <span className="w-3.5 text-right text-2xs tabular-nums text-muted-foreground/60 shrink-0">
                  {index + 1}.
                </span>
                <span className="font-mono text-2xs flex-1 min-w-0 truncate text-foreground/80">
                  {codec}
                </span>
                <div className="flex items-center shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TooltipWrapper title="Move up" description={`Move ${codec} higher in preference`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (index <= 0) return;
                        const next = [...preferredCodecs];
                        [next[index - 1]!, next[index]!] = [next[index]!, next[index - 1]!];
                        setPreferredCodecs(next);
                      }}
                      disabled={index === 0}
                      className="p-0.5 rounded hover:bg-background/80 disabled:opacity-20"
                      aria-label={`Move ${codec} up`}
                    >
                      <ChevronUp className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipWrapper>
                  <TooltipWrapper title="Move down" description={`Move ${codec} lower in preference`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (index >= preferredCodecs.length - 1) return;
                        const next = [...preferredCodecs];
                        [next[index]!, next[index + 1]!] = [next[index + 1]!, next[index]!];
                        setPreferredCodecs(next);
                      }}
                      disabled={index === preferredCodecs.length - 1}
                      className="p-0.5 rounded hover:bg-background/80 disabled:opacity-20"
                      aria-label={`Move ${codec} down`}
                    >
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipWrapper>
                  <TooltipWrapper title="Remove" description={`Remove ${codec} from offer`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (preferredCodecs.length <= 1) return;
                        setPreferredCodecs(preferredCodecs.filter((c) => c !== codec));
                      }}
                      disabled={preferredCodecs.length <= 1}
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-20"
                      aria-label={`Remove ${codec}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </TooltipWrapper>
                </div>
              </div>
            ))}
          </div>
          {preferredCodecs.length < CODEC_OPTIONS.length && (
            <div className="px-3 pb-2 pt-1 border-t border-border/20 flex flex-wrap gap-1">
              {CODEC_OPTIONS.filter((c) => !preferredCodecs.includes(c)).map((codec) => (
                <button
                  key={codec}
                  type="button"
                  onClick={() => setPreferredCodecs([...preferredCodecs, codec])}
                  className="rounded-lg px-1.5 py-0.5 text-2xs font-mono text-muted-foreground/60 hover:text-foreground hover:bg-accent/40 transition-smooth"
                >
                  + {codec}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
