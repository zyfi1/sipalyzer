import type { ReconstructedCallSession, SipDialog } from "@/types/forensics";

export type CallTraceListPreset =
  | "all"
  | "voip"
  | "sip"
  | "media"
  | "fax"
  | "answered"
  | "issues";

export const CALL_TRACE_PRESET_OPTIONS: readonly {
  id: CallTraceListPreset;
  label: string;
  title: string;
}[] = [
  { id: "all", label: "All", title: "Every reconstructed session in this capture" },
  {
    id: "voip",
    label: "VoIP",
    title: "SIP signaling and/or RTP media — typical phone / UC calls",
  },
  { id: "sip", label: "SIP", title: "Traces with SIP dialog traffic (INVITE, BYE, etc.)" },
  { id: "media", label: "RTP", title: "Traces with decoded media (RTP/codec references)" },
  { id: "fax", label: "Fax", title: "Fax or T.38 related events in the trace" },
  { id: "answered", label: "Answered", title: "Disposition is answered / connected" },
  { id: "issues", label: "Issues", title: "Has warnings or critical anomalies" },
] as const;

export function traceHints(call: ReconstructedCallSession, dialogs: SipDialog[]) {
  const legIds = new Set(call.legs.map((l) => l.callId).filter((id): id is string => Boolean(id)));
  const sipMsgCount = dialogs
    .filter((d) => legIds.has(d.callId))
    .reduce((sum, d) => sum + d.messages.length, 0);
  const hasMedia = call.mediaRefs.length > 0;
  const hasFax = call.events.some((e) => {
    const t = `${e.type} ${e.label} ${e.detail ?? ""}`.toLowerCase();
    return t.includes("fax") || t.includes("t.38") || t.includes("t38") || t.includes("udptl");
  });
  return { sipMsgCount, hasMedia, hasFax };
}

export function callMatchesTracePreset(
  call: ReconstructedCallSession,
  dialogs: SipDialog[],
  preset: CallTraceListPreset,
): boolean {
  if (preset === "all") return true;
  const h = traceHints(call, dialogs);
  switch (preset) {
    case "voip":
      return h.sipMsgCount > 0 || h.hasMedia;
    case "sip":
      return h.sipMsgCount > 0;
    case "media":
      return h.hasMedia;
    case "fax":
      return h.hasFax;
    case "answered":
      return call.disposition === "answered";
    case "issues":
      return call.anomalies.length > 0;
    default:
      return true;
  }
}

export function primarySipCallId(call: ReconstructedCallSession): string {
  return call.legs.find((leg) => typeof leg.callId === "string")?.callId ?? call.id;
}
