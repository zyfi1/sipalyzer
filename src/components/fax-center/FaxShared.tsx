/**
 * Shared fax helpers — transport badges, phase mapping, config chips, presets.
 * Used by FaxSendView and FaxActivityView.
 */
import { cn } from "@/lib/utils";
import { Shield } from "@/lib/icons";
import { FaxPresets, FAX_BAUD_RATES } from "@/api/fax";
import type { FaxBaudRate } from "@/api/fax";

/* ───── T.30 Phase Mapping ───── */

export const PHASE_LABEL: Record<string, string> = {
  // SIP call setup phases (emitted by backend)
  starting: "Starting",
  trying: "Trying",
  ringing: "Ringing",
  connected: "Connected",
  progress: "In Progress",
  // SIP INVITE phase
  connecting: "SIP INVITE",
  rtp: "RTP Session",
  // G.711 passthrough phases
  g711_fax: "G.711 Modulation",
  g711_wait: "Waiting for CED",
  g711_dcs: "DCS Negotiation",
  g711_tcf: "Training Check (TCF)",
  g711_page: "Page Transmission",
  g711_eop: "End of Procedure",
  g711_dcn: "Disconnect (DCN)",
  // T.38 phases
  t38_switch: "T.38 Re-INVITE",
  t38_wait_dis: "Waiting for DIS",
  t38_dcs: "DCS Negotiation",
  t38_tcf: "Training Check (TCF)",
  t38_page: "IFP Page Data",
  t38_eop: "End of Procedure",
  t38_wait_mcf: "Waiting for MCF",
  t38_dcn: "Disconnect (DCN)",
  t38_done: "Complete",
  // SIP/NAT diagnostic phases (for activity log, not timeline)
  nat_discovery: "NAT Discovery",
  sip_invite: "INVITE",
  sip_response: "Response",
  sip_ack: "ACK",
  sip_reinvite: "Re-INVITE",
  sip_error: "SIP Error",
  warning: "Warning",
  // Terminal phases
  complete: "Complete",
  error: "Failed",
};

export const PHASE_PCT: Record<string, number> = {
  // SIP call setup
  starting: 2,
  trying: 5,
  ringing: 10,
  connected: 15,
  progress: 12,
  connecting: 5,
  rtp: 15,
  // G.711 passthrough
  g711_fax: 18,
  g711_wait: 25,
  g711_dcs: 35,
  g711_tcf: 45,
  g711_page: 65,
  g711_eop: 82,
  g711_dcn: 95,
  // T.38
  t38_switch: 20,
  t38_wait_dis: 28,
  t38_dcs: 38,
  t38_tcf: 48,
  t38_page: 65,
  t38_eop: 82,
  t38_wait_mcf: 90,
  t38_dcn: 96,
  t38_done: 100,
  // Terminal
  complete: 100,
  error: 100,
};

export function phasePct(phase?: string): number {
  return phase ? (PHASE_PCT[phase] ?? 50) : 3;
}

export function phaseLabel(phase?: string): string {
  return phase ? (PHASE_LABEL[phase] ?? phase) : "Initializing";
}

export function phaseTransport(phase?: string): string | null {
  if (!phase) return null;
  if (phase.startsWith("t38")) return "T.38";
  if (phase.startsWith("g711")) return "G.711";
  return null;
}

/* ───── Test Pages ───── */

export interface FaxTestPreset {
  id: string;
  name: string;
  pages: number;
  description: string;
  docKind: "prebuilt" | "unbranded";
  prebuiltDocId?: "itu_test_page" | "full_diagnostic";
  variant: "quick" | "full";
  badge: string;
  brandable?: boolean;
}

export const TEST_PAGES: FaxTestPreset[] = [
  {
    id: "itu_test_page",
    name: "Quick Test",
    pages: 1,
    description: "Single page to verify your fax line works",
    docKind: "prebuilt",
    prebuiltDocId: "itu_test_page",
    variant: "quick",
    badge: "recommended",
  },
  {
    id: "full_diagnostic",
    name: "Full Diagnostic",
    pages: 2,
    description: "Multi-page test with fill patterns and line quality checks",
    docKind: "prebuilt",
    prebuiltDocId: "full_diagnostic",
    variant: "full",
    badge: "deep check",
  },
  {
    id: "quick_unbranded",
    name: "Quick Unbranded",
    pages: 1,
    description: "Same quick checks without default SIPalyzer branding",
    docKind: "unbranded",
    variant: "quick",
    badge: "neutral",
    brandable: true,
  },
  {
    id: "full_unbranded",
    name: "Full Unbranded",
    pages: 2,
    description: "Full diagnostic layout with optional custom branding",
    docKind: "unbranded",
    variant: "full",
    badge: "neutral",
    brandable: true,
  },
];

/* ───── Fax Modes ───── */

export const FAX_MODES = [
  {
    id: "t38",
    label: "T.38",
    description: "Virtual fax (recommended)",
    color: "text-success",
    bg: "bg-success/10 border-success/50",
    preset: FaxPresets.default,
    g711Only: false,
  },
  {
    id: "g711u",
    label: "G.711μ",
    description: "Audio passthrough (mu-law)",
    color: "text-info",
    bg: "bg-info/10 border-info/50",
    preset: FaxPresets.g711Fallback,
    g711Only: true,
  },
] as const;

export { FAX_BAUD_RATES };
export type { FaxBaudRate };

/* ───── Registrar helpers ───── */

export function getUseCase(r: { use_case?: string | null; useCase?: string | null }): string | null | undefined {
  return r.use_case ?? r.useCase ?? null;
}

/** Shape of a single entry in registrationStore.testResults */
interface TestResultEntry {
  success: boolean;
  status_code: number;
  unregistered?: boolean;
}

/**
 * Returns the registrar's SIP registration status.
 *
 * Checks two data sources (most-recent wins):
 * 1. `testResults` from registrationStore — updated immediately after every REGISTER action.
 * 2. `healthRegistrars` from troubleshootingStore — populated by the backend health API.
 *
 * - `true`  — actively registered (200 OK confirmed)
 * - `false` — not registered (explicitly failed or unregistered)
 * - `null`  — unknown (no data from either source)
 */
export function registrationStatus(
  registrarId: string | undefined,
  healthRegistrars: { registrar_id: string; registered: boolean }[] | undefined,
  testResults?: Record<string, TestResultEntry>,
): boolean | null {
  if (!registrarId) return null;

  // testResults is the most immediate source — check it first
  if (testResults) {
    const result = testResults[registrarId] as TestResultEntry & { unregistered?: boolean } | undefined;
    if (result) {
      if (result.unregistered) return false;
      // status_code 0 with status "Not registered" means never tested — treat as unknown
      if (result.status_code === 0 && result.success) return null;
      return result.success && result.status_code === 200;
    }
  }

  // Fall back to health data
  if (healthRegistrars) {
    const entry = healthRegistrars.find((h) => h.registrar_id === registrarId);
    if (entry) return entry.registered;
  }

  return null;
}

/**
 * Returns true only when we have positive confirmation of SIP registration.
 * Returns false for unregistered AND unknown states.
 *
 * @param testResults - Pass `useRegistrationStore(s => s.testResults)` for immediate updates.
 */
export function isRegistered(
  registrarId: string | undefined,
  healthRegistrars: { registrar_id: string; registered: boolean }[] | undefined,
  testResults?: Record<string, TestResultEntry>,
): boolean {
  return registrationStatus(registrarId, healthRegistrars, testResults) === true;
}

/* ───── Format helpers ───── */

export function formatBaud(baud: number): string {
  return baud >= 1000 ? `${(baud / 1000).toFixed(1)}k` : String(baud);
}

export function formatDuration(ms: number): string {
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return `${mins}m ${remainSecs}s`;
}

/* ───── Progress Interfaces ───── */

/** Progress for an active outbound fax send */
export interface FaxSendProgress {
  phase: string;
  udptlPacketsSent: number;
  udptlPacketsReceived?: number;
  elapsedSecs?: number;
  captureSessionId?: string;
  /** SIP message summary (e.g. "INVITE sip:..." or "200 OK") */
  sipMessage?: string;
  /** SDP info summary (e.g. "SDP: 1.2.3.4:10000 PCMU") */
  sdpInfo?: string;
  /** NAT discovery info (e.g. "STUN: 1.2.3.4:45678 (symmetric NAT)") */
  natInfo?: string;
  /** Remote RTP/UDPTL address (e.g. "1.2.3.4:39282") */
  remoteRtp?: string;
  /** Warning message */
  warning?: string;
  /** Additional detail for warnings/info */
  detail?: string;
  /** Direction of the SIP/protocol message */
  messageDirection?: "outbound" | "inbound" | "info";
  /** Whether symmetric NAT was detected */
  isSymmetricNat?: boolean;
}

/** Progress for an active inbound fax receive */
export interface FaxReceiveProgress {
  receiveId: string;
  callId?: string;
  sender?: string;
  registrarId?: string;
  phase: string;
  transport?: string;
  udptlPacketsSent?: number;
  udptlPacketsReceived?: number;
  elapsedSecs?: number;
}

/* ───── Transport Badge ───── */

export function TransportBadge({ transport, count, size = "sm" }: { transport: string; count?: number; size?: "sm" | "md" }) {
  const isT38 = transport.includes("T.38");
  const sizeClass = size === "md" ? "text-xs px-2 py-0.5" : "text-2xs px-1.5 py-0.5";
  return (
    <span
      className={cn(
        "font-bold rounded border inline-flex items-center gap-1",
        sizeClass,
        isT38
          ? "bg-success/10 border-success/30 text-success"
          : "bg-info/10 border-info/30 text-info"
      )}
    >
      {transport}
      {count != null && <span className="font-mono opacity-70">({count})</span>}
    </span>
  );
}

/* ───── Config Chip ───── */

export function ConfigChip({ children, active, variant }: {
  children: React.ReactNode;
  active?: boolean;
  variant?: "emerald" | "blue" | "default";
}) {
  const activeColors = variant === "emerald"
    ? "bg-success/10 border-success/30 text-success"
    : variant === "blue"
    ? "bg-info/10 border-info/30 text-info"
    : "bg-accent border-foreground/20 text-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-medium transition-smooth",
        active ? activeColors : "border-border text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

/* ───── Config Summary Bar ───── */

export function FaxConfigSummary({ useG711Only, baudRate, ecm, resolution }: {
  useG711Only: boolean;
  baudRate: number;
  ecm: boolean;
  resolution: string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ConfigChip active={!useG711Only} variant={useG711Only ? "blue" : "emerald"}>
        {useG711Only ? "G.711" : "T.38"}
      </ConfigChip>
      <ConfigChip>{formatBaud(baudRate)} bps</ConfigChip>
      <ConfigChip active={ecm} variant="emerald">
        <Shield className="h-3 w-3" />
        ECM {ecm ? "On" : "Off"}
      </ConfigChip>
      <ConfigChip>{resolution === "fine" ? "Fine" : "Standard"}</ConfigChip>
    </div>
  );
}
