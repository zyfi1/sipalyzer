/**
 * Central Troubleshooting Store — single source of truth for all troubleshooting data.
 *
 * All views (Dashboard, Forensics, Packet Capture, Registration, Softphone) consume
 * registration health, call history, capture sessions, timeline, and findings from here.
 * No view owns or duplicates this history; they subscribe to this store.
 *
 * Data flow:
 * - refresh(): loads registration health from backend (get_registration_health).
 * - syncFromStores({ calls, registrars, sessions }): called by TroubleshootingSync when
 *   softphone, registration, or packet capture state changes. Recomputes timeline + findings in one batch.
 * - Packet monitor remains user-controlled; capture sessions list is synced for linkage only.
 *
 * Performance: normalized by id where useful, single batched set() on sync, shallow selectors.
 */

import { create } from "zustand";
import { useActivityMonitorStore, type ActivityMonitorWorkItem } from "@/stores/activityMonitorStore";
import { getRegistrationHealth } from "@/api/registration";
import { getRtpStreams, getSipDialogs } from "@/api/packetCapture";
import { extractErrorMessage, logError } from "@/lib/errorUtils";
import { VOIP_THRESHOLDS } from "@/lib/voipThresholds";
import { getSipCode } from "@/data/sipResponseCodeMap";
import { getArticlesForSipCode } from "@/lib/troubleshootingEngine";
import type {
  RegistrationHealthResponse,
  CallQualitySummary,
  ForensicFinding,
  ForensicsTimelineEntry,
  CallTraceContext,
  RootCauseHint,
} from "@/types/forensics";
import type { RtpStreamInfo } from "@/types/packetCapture";
import type { CaptureSession } from "@/types/packetCapture";
import type { Call } from "@/lib/softphone";
import type { FaxFolder, ReceivedFax, SentFaxJob } from "@/types/fax";

/** Central thresholds from voipThresholds — no more scattered magic numbers. */
const MOS_GOOD = VOIP_THRESHOLDS.mos.fair;       // 3.6 (ITU-T G.107 R>70)
const MOS_FAIR = VOIP_THRESHOLDS.mos.poor;        // 3.1 (ITU-T G.107 R>60)
const LOSS_GOOD = VOIP_THRESHOLDS.packetLoss.acceptable;  // 1.0% (Cisco)
const LOSS_POOR = VOIP_THRESHOLDS.packetLoss.degraded;    // 3.0% (Cisco)
const JITTER_GOOD_MS = VOIP_THRESHOLDS.jitter.acceptable; // 30ms (Cisco)
const JITTER_POOR_MS = VOIP_THRESHOLDS.jitter.degraded;   // 50ms (Cisco)
const MAX_TIMELINE_ENTRIES = 500;

const LOW_CONFIDENCE_SCORE = 0.45;
const MEDIUM_CONFIDENCE_SCORE = 0.65;
const HIGH_CONFIDENCE_SCORE = 0.85;

function confidenceLevelForScore(score: number): RootCauseHint["confidenceLevel"] {
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function withHintConfidence(
  hint: Omit<RootCauseHint, "confidenceScore" | "confidenceLevel" | "uncertaintyState">,
  score: number,
  uncertaintyReasons?: RootCauseHint["uncertaintyReasons"]
): RootCauseHint {
  const normalizedScore = Math.max(0, Math.min(1, score));
  return {
    ...hint,
    confidenceScore: normalizedScore,
    confidenceLevel: confidenceLevelForScore(normalizedScore),
    uncertaintyState: uncertaintyReasons && uncertaintyReasons.length > 0 ? "uncertain" : "certain",
    uncertaintyReasons: uncertaintyReasons && uncertaintyReasons.length > 0 ? uncertaintyReasons : undefined,
  };
}

function qualityTier(
  mos: number | null,
  lossPercent: number | null,
  jitterMs: number | null
): "good" | "fair" | "poor" | "unknown" {
  if (mos == null && lossPercent == null && jitterMs == null) return "unknown";
  const loss = lossPercent ?? 0;
  const jitter = jitterMs ?? 0;
  const m = mos ?? 4;
  if (m >= MOS_GOOD && loss <= LOSS_GOOD && jitter <= JITTER_GOOD_MS) return "good";
  if (m < MOS_FAIR || loss >= LOSS_POOR || jitter >= JITTER_POOR_MS) return "poor";
  return "fair";
}


function computeRootCauseHints(trace: CallTraceContext): RootCauseHint[] {
  const hints: RootCauseHint[] = [];
  const dialog = trace.dialog;
  const softphone = trace.softphoneCall;
  const seenCodes = new Set<string>();
  const hasRtpData = (trace.rtpStreams?.length ?? 0) > 0;
  const hasDialogData = Boolean(dialog);

  // ── Registration state at call time ──
  if (trace.registrationAtCall && !trace.registrationAtCall.success) {
    const regCode = trace.registrationAtCall.statusCode;
    const articles = regCode ? getArticlesForSipCode(regCode) : [];
    hints.push(withHintConfidence({
      id: "registration-failed",
      severity: "error",
      title: "Registration was down at call time",
      description: `${trace.registrationAtCall.registrarName} was not registered when this call was placed (${trace.registrationAtCall.statusCode} ${trace.registrationAtCall.statusText}).`,
      evidence: [{ type: "time", value: trace.registrationAtCall.timestamp, label: "Registration result" }],
      articleId: articles[0]?.id,
    }, HIGH_CONFIDENCE_SCORE));
  }

  // ── SIP dialog analysis — cover ALL response codes using the SIP code map ──
  if (dialog) {
    const hasInvite = dialog.messages.some((m) => m.methodOrCode === "INVITE");
    const finalResponses = dialog.messages
      .map((m) => {
        const code = Number.parseInt(m.methodOrCode, 10);
        return Number.isNaN(code) ? null : { code, message: m };
      })
      .filter((entry): entry is { code: number; message: (typeof dialog.messages)[number] } => entry != null && entry.code >= 200);
    const has200 = finalResponses.some((entry) => entry.code === 200);
    const finalNon2xx = finalResponses.filter((entry) => entry.code >= 300);
    const lastFinalNon2xx = finalNon2xx.length > 0 ? finalNon2xx[finalNon2xx.length - 1] : undefined;

    if (hasInvite && !has200) {
      if (lastFinalNon2xx) {
        const code = lastFinalNon2xx.code;
        const codeInfo = getSipCode(code);
        const busyOrDeclined = new Set([486, 600, 603]);
        const temporaryUnavailable = new Set([480]);
        const wasBusyOrDeclined = busyOrDeclined.has(code);
        const wasTemporaryUnavailable = temporaryUnavailable.has(code);

        hints.push(withHintConfidence({
          id: "invite-final-non2xx",
          severity: wasBusyOrDeclined || wasTemporaryUnavailable ? "warning" : "error",
          title: wasBusyOrDeclined
            ? "Call was rejected by remote side"
            : wasTemporaryUnavailable
              ? "Remote endpoint was unavailable"
              : "Call ended with SIP failure response",
          description: codeInfo
            ? `The call ended with ${code} ${codeInfo.name}. This is a final SIP response, not a missing-answer timeout.`
            : `The call ended with SIP ${code}. This is a final SIP response, not a missing-answer timeout.`,
          evidence: [{ type: "packet", value: String(lastFinalNon2xx.message.packetIndex), label: `${code} response` }],
        }, HIGH_CONFIDENCE_SCORE));
      } else {
        const inviteMsg = dialog.messages.find((m) => m.methodOrCode === "INVITE");
        hints.push(withHintConfidence({
          id: "invite-no-final-response",
          severity: "error",
          title: "No final SIP response to INVITE",
          description: "The INVITE never received a final response (2xx-6xx). This usually indicates timeout, routing, or connectivity issues.",
          evidence: inviteMsg
            ? [{ type: "packet", value: String(inviteMsg.packetIndex), label: "INVITE packet" }]
            : undefined,
          articleId: "sip-timeout",
        }, MEDIUM_CONFIDENCE_SCORE, [{
          code: "insufficient-evidence",
          message: "No final SIP response was captured, so multiple timeout causes remain possible.",
        }]));
      }
    }

    const authChallenges = dialog.messages.filter((m) => m.methodOrCode === "401" || m.methodOrCode === "407");
    const lastChallenge = authChallenges.at(-1);
    if (authChallenges.length >= 3 && !has200 && lastChallenge) {
      hints.push(withHintConfidence({
        id: "sip-auth-loop",
        severity: "error",
        title: "Repeated SIP authentication challenge loop",
        description: "The call repeatedly received 401/407 authentication challenges without completing. Check SIP credentials, auth realm, and proxy authentication settings.",
        evidence: [{ type: "packet", value: String(lastChallenge.packetIndex), label: "Latest auth challenge" }],
        articleId: "sip-auth-failed",
      }, HIGH_CONFIDENCE_SCORE));
    }

    // Scan SIP response codes — only flag genuine errors, not normal auth or call flow.
    //
    // Codes that are NORMAL and should NOT generate hints:
    // - 401: Digest auth challenge (REGISTER→401→REGISTER w/creds→200 is standard)
    // - 407: Proxy auth challenge (same pattern as 401)
    // - 487: Request Terminated — caller cancelled, perfectly normal
    // - 100, 180, 183, 199, 200, 202, 204: informational/success (already filtered by < 400)
    //
    // Codes that are CONTEXTUAL (warning, not error):
    // - 486/600: Busy — remote party is busy, not an error on our side
    // - 480: Temporarily Unavailable — endpoint offline, informational
    // - 302: Redirect — normal call forwarding
    // - 603: Decline — user chose not to answer
    const NORMAL_CODES = new Set([401, 407, 487]);
    const INFO_CODES = new Set([486, 600, 603, 480, 302, 380]);

    for (const msg of dialog.messages) {
      const codeStr = msg.methodOrCode;
      if (!codeStr) continue;
      const code = parseInt(codeStr, 10);
      if (isNaN(code) || code < 400) continue;
      if (seenCodes.has(codeStr)) continue;
      seenCodes.add(codeStr);

      // Skip codes that are part of normal SIP operation
      if (NORMAL_CODES.has(code)) continue;

      const codeInfo = getSipCode(code);
      const articles = getArticlesForSipCode(code);
      const sipMsg = dialog.messages.find((m) => m.methodOrCode === codeStr);

      // Informational codes get "warning" severity; real errors get "error"
      const isInfo = INFO_CODES.has(code);
      const severity: "error" | "warning" = isInfo ? "warning" : "error";

      hints.push(withHintConfidence({
        id: `sip-${code}`,
        severity,
        title: codeInfo ? `${code} ${codeInfo.name}` : `SIP ${code}`,
        description: codeInfo
          ? codeInfo.description.slice(0, 200)
          : `SIP error response ${code} detected in the call dialog.`,
        evidence: sipMsg
          ? [{ type: "packet", value: String(sipMsg.packetIndex), label: `${code} packet` }]
          : undefined,
        articleId: articles[0]?.id,
      }, isInfo ? MEDIUM_CONFIDENCE_SCORE : HIGH_CONFIDENCE_SCORE));
    }

    // No RTP after 200 OK — one-way / no audio indicator
    if (has200 && trace.rtpStreams?.length === 0) {
      hints.push(withHintConfidence({
        id: "rtp-missing",
        severity: "warning",
        title: "No RTP stream after 200 OK",
        description: "Call was answered but no RTP media was detected. Possible one-way or no audio.",
        evidence: dialog.messages
          .filter((m) => m.methodOrCode === "200")
          .map((m) => ({ type: "packet" as const, value: String(m.packetIndex), label: "200 OK" })),
        articleId: "no-audio",
      }, MEDIUM_CONFIDENCE_SCORE, [{
        code: "missing-rtp",
        message: "No RTP packets were captured, so this may be either media setup failure or incomplete capture scope.",
      }]));
    }
  }

  // ── Softphone call failure ──
  if (softphone?.state === "failed" && softphone.errorMessage) {
    const callCode = softphone.statusCode;
    const articles = callCode ? getArticlesForSipCode(callCode) : [];
    hints.push(withHintConfidence({
      id: "softphone-failed",
      severity: "error",
      title: "Call failed",
      description: softphone.errorMessage,
      evidence: softphone.statusCode
        ? [{ type: "call", value: trace.callId, label: "Call" }]
        : undefined,
      articleId: articles[0]?.id,
    }, hasDialogData ? HIGH_CONFIDENCE_SCORE : MEDIUM_CONFIDENCE_SCORE, hasDialogData ? undefined : [{
      code: "missing-dialog",
      message: "The failure is from softphone signaling only because no SIP dialog capture is available.",
    }]));
  }

  // ── RTP quality analysis — specific issue patterns with article links ──
  if (trace.rtpStreams?.length) {
    // Poor MOS
    const lowMos = trace.rtpStreams.filter((s) => s.mosScore < MOS_FAIR);
    if (lowMos.length > 0) {
      const worst = lowMos.reduce((a, b) => (a.mosScore < b.mosScore ? a : b));
      hints.push(withHintConfidence({
        id: "rtp-low-mos",
        severity: worst.mosScore < VOIP_THRESHOLDS.mos.poor ? "error" : "warning",
        title: "Low MOS score",
        description: `${lowMos.length} stream(s) with MOS below ${MOS_FAIR} (worst: ${worst.mosScore.toFixed(2)}). Voice quality is degraded.`,
        articleId: "poor-mos-score",
      }, HIGH_CONFIDENCE_SCORE));
    }

    // High jitter
    const highJitter = trace.rtpStreams.filter((s) => s.jitter >= JITTER_GOOD_MS);
    if (highJitter.length > 0) {
      const worst = highJitter.reduce((a, b) => (a.jitter > b.jitter ? a : b));
      hints.push(withHintConfidence({
        id: "rtp-high-jitter",
        severity: worst.jitter >= JITTER_POOR_MS ? "error" : "warning",
        title: "High jitter detected",
        description: `${highJitter.length} stream(s) with jitter above ${JITTER_GOOD_MS}ms (worst: ${worst.jitter.toFixed(0)}ms). Audio may sound choppy.`,
        articleId: "high-jitter",
      }, HIGH_CONFIDENCE_SCORE));
    }

    // High packet loss
    const highLoss = trace.rtpStreams.filter((s) => s.lossPercentage >= LOSS_GOOD);
    if (highLoss.length > 0) {
      const worst = highLoss.reduce((a, b) => (a.lossPercentage > b.lossPercentage ? a : b));
      hints.push(withHintConfidence({
        id: "rtp-high-loss",
        severity: worst.lossPercentage >= LOSS_POOR ? "error" : "warning",
        title: "High packet loss",
        description: `${highLoss.length} stream(s) with loss above ${LOSS_GOOD}% (worst: ${worst.lossPercentage.toFixed(1)}%). Audio may have gaps.`,
        articleId: "packet-loss-impact",
      }, HIGH_CONFIDENCE_SCORE));
    }
  }

  if (!hasDialogData && !hasRtpData) {
    hints.push(withHintConfidence({
      id: "limited-evidence",
      severity: "info",
      title: "Limited call evidence",
      description: "No SIP dialog or RTP stream data is available for this call, so root-cause hints are less certain.",
    }, LOW_CONFIDENCE_SCORE, [{
      code: "insufficient-evidence",
      message: "Capture data is unavailable for this call.",
    }]));
  }

  const candidateHints = hints.filter((hint) => hint.severity !== "info");
  if (candidateHints.length > 1) {
    for (const [index, hint] of hints.entries()) {
      if (hint.severity === "info") continue;
      const hasCompetingReason = hint.uncertaintyReasons?.some((reason) => reason.code === "competing-hypotheses");
      if (hasCompetingReason) continue;
      const loweredScore = Math.max(LOW_CONFIDENCE_SCORE, hint.confidenceScore - 0.1);
      hints[index] = {
        ...hint,
        confidenceScore: loweredScore,
        confidenceLevel: confidenceLevelForScore(loweredScore),
        uncertaintyState: "uncertain",
        uncertaintyReasons: [
          ...(hint.uncertaintyReasons ?? []),
          {
            code: "competing-hypotheses",
            message: "Several plausible causes were detected for this call.",
          },
        ],
      };
    }
  }

  return hints;
}

export interface TroubleshootingSyncPayload {
  calls: Call[];
  registrars: Array<{
    id?: string;
    name: string;
    username?: string;
    domain?: string;
    transport?: string;
    remote_port?: number;
  }>;
  sessions?: CaptureSession[];
}

export interface TroubleshootingState {
  /** Registration health from get_registration_health (loaded by refresh()). */
  registrationHealth: RegistrationHealthResponse | null;
  /** Call quality summaries derived from last sync. */
  callQualitySummaries: CallQualitySummary[];
  /** Auto-computed findings (registration down, poor quality, etc.). */
  findings: ForensicFinding[];
  /** Unified timeline: registration test events + call events. */
  timeline: ForensicsTimelineEntry[];
  /** Capture sessions list (synced for linkage; monitor is user-controlled). */
  captureSessions: CaptureSession[];
  /** Received faxes (central store; Fax Center and timeline read from here). */
  receivedFaxes: ReceivedFax[];
  /** Sent fax jobs (central store; status/results updated in place). */
  sentFaxJobs: SentFaxJob[];
  /** User-manageable fax folders for list organization. */
  faxFolders: FaxFolder[];
  /** Folder assignment keyed by list item key: sent:<id> | received:<id>. */
  faxFolderAssignments: Record<string, string>;
  /** True while refresh() (get_registration_health) is in flight. */
  loadingHealth: boolean;
  /** True while selectCallForTrace() is loading RTP/dialogs; cleared on set or clearTrace. */
  loadingTrace: boolean;
  error: string | null;
  /** ISO timestamp of last successful health refresh; null until first success. */
  lastHealthRefreshAt: string | null;
  /** ISO timestamp when timeline was last cleared; events before this are filtered out. */
  timelineClearedAt: string | null;

  /** Selected call for drill-down (dialog, RTP, hints). */
  selectedTrace: CallTraceContext | null;
  rootCauseHints: RootCauseHint[];
  /** Error from last selectCallForTrace failure (RTP/dialog load); cleared on success or clearTrace. */
  traceError: string | null;

  /** Load registration health from backend (with retry). */
  refresh: () => Promise<void>;
  /**
   * Single entry point for external data. Call when softphone calls, registrars, or capture sessions change.
   * Recomputes timeline and findings in one batch (high performance).
   */
  syncFromStores: (payload: TroubleshootingSyncPayload) => void;
  /** Clear all timeline entries. */
  clearTimeline: () => void;
  /** Remove one timeline entry by id. */
  removeTimelineEntry: (id: string) => void;
  /** Select a call for trace drill-down (loads RTP/dialog from capture if sessionId present). */
  selectCallForTrace: (
    call: Call,
    opts: { registrationAtCall?: CallTraceContext["registrationAtCall"]; sessionId?: string }
  ) => Promise<void>;
  clearTrace: () => void;
  setError: (error: string | null) => void;
  /** Refresh capture sessions list from payload (caller gets from packetCaptureStore). */
  setCaptureSessions: (sessions: CaptureSession[]) => void;
  /** Add or update a received fax (from backend when T.38 session completes). */
  addReceivedFax: (fax: ReceivedFax) => void;
  /** Add a sent fax job (when user starts send). */
  addSentFaxJob: (job: SentFaxJob) => void;
  /** Update a sent fax job (status, result, sipCallId, duration). */
  updateSentFaxJob: (id: string, update: Partial<SentFaxJob>) => void;
  /** Remove a sent fax job by id (and its timeline entry). */
  removeSentFaxJob: (id: string) => void;
  /** Remove all sent fax jobs and their timeline entries (local history only). */
  clearSentFaxJobs: () => void;
  /** Remove a received fax by id. */
  removeReceivedFax: (id: string) => void;
  createFaxFolder: (name: string) => string | null;
  renameFaxFolder: (id: string, name: string) => void;
  deleteFaxFolder: (id: string) => void;
  assignFaxFolder: (itemKey: string, folderId: string) => void;
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function buildRegistrarDisplay(reg: {
  id?: string;
  name?: string;
  username?: string;
  domain?: string;
  transport?: string;
  remote_port?: number;
}): string {
  const cleanName = reg.name?.trim();
  if (cleanName && !isLikelyUuid(cleanName)) return cleanName;

  const user = reg.username?.trim();
  const domain = reg.domain?.trim();
  if (user && domain) return `${user}@${domain}`;
  if (domain) return domain;
  if (user) return user;
  return reg.id?.trim() || "Unknown registrar";
}

function formatTestTypeLabel(testType: string): string {
  const raw = testType.trim();
  if (!raw) return "Registration test";
  if (raw === "basic_registration" || raw === "BasicRegistration") return "Registration";
  if (raw === "deregistration" || raw === "Deregistration") return "Unregistration";
  if (raw === "test_suite" || raw === "TestSuite") return "Test Suite";
  return raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const useTroubleshootingStore = create<TroubleshootingState>((set, get) => ({
      registrationHealth: null,
      callQualitySummaries: [],
      findings: [],
      timeline: [],
      captureSessions: [],
      receivedFaxes: [],
      sentFaxJobs: [],
      faxFolders: [],
      faxFolderAssignments: {},
      loadingHealth: false,
      loadingTrace: false,
      error: null,
      lastHealthRefreshAt: null,
      timelineClearedAt: null,
      selectedTrace: null,
      rootCauseHints: [],
      traceError: null,

      refresh: async () => {
        const maxAttempts = 3;
        const backoffMs = 300;
        set({ loadingHealth: true, error: null });
        let lastError: string = "";
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const health = await getRegistrationHealth();
            set({
              registrationHealth: health,
              loadingHealth: false,
              error: null,
              lastHealthRefreshAt: new Date().toISOString(),
            });
            return;
          } catch (e) {
            lastError = extractErrorMessage(e);
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
        }
        set({ loadingHealth: false, error: lastError });
      },

  syncFromStores: (payload) => {
    const { calls, registrars, sessions } = payload;
    const { registrationHealth } = get();

    const regNames = new Map(
      registrars
        .map((r): [string, string] => [r.id ?? "", buildRegistrarDisplay(r)])
        .filter(([id]) => id != null && id !== "")
    );

    const callQualitySummaries: CallQualitySummary[] = calls.map((c) => {
      const mos = c.savedMetrics?.mos ?? null;
      const jitter = c.savedMetrics?.jitter_ms ?? null;
      const loss = c.savedMetrics?.loss_percent ?? null;
      const tier = qualityTier(mos, loss, jitter);
      return {
        callId: c.id,
        target: c.target,
        startTime: c.startTime,
        endTime: c.endTime,
        state: c.state,
        statusCode: c.statusCode,
        statusText: c.statusText,
        errorMessage: c.errorMessage,
        mos,
        jitterMs: jitter,
        lossPercent: loss,
        qualityTier: tier,
        captureSessionId: c.captureSessionId,
        registrarId: c.registrarId ?? null,
      };
    });

    const findings: ForensicFinding[] = [];
    const lastSuccessByReg = new Map<string, string>();
    for (const r of registrationHealth?.registrars ?? []) {
      if (r.registered && r.last_test_time) lastSuccessByReg.set(r.registrar_id, r.last_test_time);
    }

    for (const r of registrationHealth?.registrars ?? []) {
      const name = regNames.get(r.registrar_id) ?? r.registrar_id;
      if (r.registered && r.health_score != null && r.health_score < 50) {
        findings.push({
          id: `reg-health-${r.registrar_id}`,
          severity: "warning",
          title: "Low registration health",
          description: `${name} has health score ${r.health_score}. Consider re-testing.`,
          confidenceLevel: "medium",
          confidenceScore: MEDIUM_CONFIDENCE_SCORE,
          uncertaintyState: "uncertain",
          uncertaintyReasons: [{
            code: "insufficient-evidence",
            message: "Health score suggests risk but does not isolate a single failure cause.",
          }],
          timestamp: r.last_test_time ?? undefined,
          link: { type: "registrar", id: r.registrar_id, label: name },
        });
      }
    }

    for (const s of callQualitySummaries) {
      if (s.state === "failed" && s.errorMessage) {
        findings.push({
          id: `call-failed-${s.callId}`,
          severity: "critical",
          title: "Call failed",
          description: `Call to ${s.target} failed: ${s.errorMessage}`,
          confidenceLevel: "medium",
          confidenceScore: MEDIUM_CONFIDENCE_SCORE,
          uncertaintyState: "uncertain",
          uncertaintyReasons: [{
            code: "insufficient-evidence",
            message: "Failure is confirmed, but exact root cause may need call trace details.",
          }],
          timestamp: s.startTime,
          link: { type: "call", id: s.callId, label: s.target },
        });
      } else if (s.qualityTier === "poor" && (s.mos != null || s.lossPercent != null || s.jitterMs != null)) {
        const parts = [];
        if (s.mos != null) parts.push(`MOS ${s.mos.toFixed(1)}`);
        if (s.lossPercent != null) parts.push(`${s.lossPercent.toFixed(1)}% loss`);
        if (s.jitterMs != null) parts.push(`${s.jitterMs.toFixed(0)}ms jitter`);
        findings.push({
          id: `call-quality-${s.callId}`,
          severity: "warning",
          title: "Poor call quality",
          description: `Call to ${s.target} had poor quality (${parts.join(", ")}).`,
          confidenceLevel: "high",
          confidenceScore: HIGH_CONFIDENCE_SCORE,
          uncertaintyState: "certain",
          timestamp: s.endTime ?? s.startTime,
          link: { type: "call", id: s.callId, label: s.target },
        });
      }
    }

    for (const job of get().sentFaxJobs ?? []) {
      if (job.status === "failed" && (job.errorMessage || job.completedAt)) {
        findings.push({
          id: `fax-failed-${job.id}`,
          severity: "critical",
          title: "Fax send failed",
          description: `Fax to ${job.target} failed${job.errorMessage ? `: ${job.errorMessage}` : ""}. Check Troubleshooting for SIP details.`,
          confidenceLevel: "medium",
          confidenceScore: MEDIUM_CONFIDENCE_SCORE,
          uncertaintyState: "uncertain",
          uncertaintyReasons: [{
            code: "insufficient-evidence",
            message: "Fax failure is confirmed, but SIP/RTP traces are needed for exact root cause.",
          }],
          timestamp: job.completedAt ?? job.createdAt,
          link: { type: "fax", id: job.id, label: job.target },
        });
      }
    }
    for (const fax of get().receivedFaxes ?? []) {
      if (!fax.session.success) {
        findings.push({
          id: `fax-receive-failed-${fax.id}`,
          severity: "critical",
          title: "Fax receive failed",
          description: `Inbound fax from ${fax.sender} failed${fax.errorMessage ? `: ${fax.errorMessage}` : "."}`,
          confidenceLevel: "medium",
          confidenceScore: MEDIUM_CONFIDENCE_SCORE,
          uncertaintyState: "uncertain",
          uncertaintyReasons: [{
            code: "insufficient-evidence",
            message: "Receive failure is confirmed, but SIP/RTP traces may be needed for exact cause.",
          }],
          timestamp: fax.session.endedAt ?? fax.receivedAt,
          link: { type: "fax", id: fax.id, label: fax.sender },
        });
      }
    }

    const newEvents: ForensicsTimelineEntry[] = [];
    const testHistory = registrationHealth?.test_history ?? [];
    for (const t of testHistory) {
      const name = regNames.get(t.registrar_id) ?? t.registrar_id;
      const testTypeLabel = formatTestTypeLabel(t.test_type);
      const responseMs = t.response_time_ms > 0 ? `${t.response_time_ms}ms` : null;
      newEvents.push({
        id: `reg-${t.timestamp}-${t.registrar_id}`,
        timestamp: t.timestamp,
        kind: "registration",
        label: t.success ? `Registration OK · ${name}` : `Registration failed · ${name}`,
        detail: responseMs ? `${testTypeLabel} · ${responseMs}` : testTypeLabel,
        success: t.success,
        refId: t.registrar_id,
      });
    }
    for (const c of calls) {
      const mos = c.savedMetrics?.mos;
      const loss = c.savedMetrics?.loss_percent;
      const jitter = c.savedMetrics?.jitter_ms;
      const tier = qualityTier(mos ?? null, loss ?? null, jitter ?? null);
      newEvents.push({
        id: `call-${c.startTime}-${c.id}`,
        timestamp: c.startTime,
        kind: "call",
        label: `Call to ${c.target}`,
        detail: c.state,
        success: c.state === "ended" || c.state === "active",
        refId: c.id,
      });
      if (c.endTime && (mos != null || loss != null || jitter != null)) {
        newEvents.push({
          id: `call-q-${c.endTime}-${c.id}`,
          timestamp: c.endTime,
          kind: "call_quality",
          label: `Quality: ${c.target}`,
          detail: mos != null
            ? `MOS ${mos.toFixed(1)}`
            : loss != null
              ? `${loss.toFixed(1)}% loss`
              : jitter != null
                ? `${jitter.toFixed(0)}ms jitter`
                : undefined,
          qualityTier: tier,
          refId: c.id,
        });
      }
    }

    const receivedFaxes = get().receivedFaxes ?? [];
    const sentFaxJobs = get().sentFaxJobs ?? [];
    for (const fax of receivedFaxes) {
      newEvents.push({
        id: `fax-r-${fax.receivedAt}-${fax.id}`,
        timestamp: fax.receivedAt,
        kind: "fax_received",
        label: `Fax from ${fax.sender}`,
        detail: `${fax.pageCount} page(s)`,
        success: fax.session.success,
        refId: fax.id,
      });
    }
    for (const job of sentFaxJobs) {
      if (job.status === "pending" || job.status === "sending") continue;
      newEvents.push({
        id: `fax-s-${job.createdAt}-${job.id}`,
        timestamp: job.completedAt ?? job.createdAt,
        kind: "fax_sent",
        label: `Fax to ${job.target}`,
        detail: job.status === "sent" ? `${job.pageCount} page(s)` : job.status,
        success: job.status === "sent",
        refId: job.id,
      });
    }

    const existing = get().timeline;
    const clearedAt = get().timelineClearedAt;
    const clearedAtMs = clearedAt ? new Date(clearedAt).getTime() : 0;

    // Filter out events that occurred before the timeline was cleared
    const filteredNewEvents = newEvents.filter((e) => new Date(e.timestamp).getTime() >= clearedAtMs);

    const existingIds = new Set(existing.map((e) => e.id));
    let merged = [...existing];
    for (const e of filteredNewEvents) {
      if (!existingIds.has(e.id)) {
        merged.push(e);
        existingIds.add(e.id);
      }
    }
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (merged.length > MAX_TIMELINE_ENTRIES) {
      merged = merged.slice(-MAX_TIMELINE_ENTRIES);
    }

    set({
      callQualitySummaries,
      findings,
      timeline: merged,
      ...(sessions !== undefined ? { captureSessions: sessions } : {}),
    });
  },

  clearTimeline: () => set({ timeline: [], timelineClearedAt: new Date().toISOString() }),

  removeTimelineEntry: (id) =>
    set((s) => ({ timeline: s.timeline.filter((e) => e.id !== id) })),

  selectCallForTrace: async (call, opts) => {
    set({ traceError: null, loadingTrace: true });
    const sessionId = opts.sessionId ?? call.captureSessionId ?? undefined;
    let rtpStreams: RtpStreamInfo[] = [];
    let dialog: CallTraceContext["dialog"];
    if (sessionId) {
      try {
        const [streams, dialogs] = await Promise.all([
          getRtpStreams(sessionId),
          getSipDialogs(sessionId),
        ]);
        rtpStreams = streams ?? [];
        const byCallId = (dialogs ?? []).find((d) => d != null && d.callId === call.sipCallId);
        if (byCallId) dialog = byCallId;
      } catch (e) {
        if (import.meta.env.DEV) logError("selectCallForTrace", e);
        set({
          traceError: extractErrorMessage(e),
          selectedTrace: null,
          rootCauseHints: [],
          loadingTrace: false,
        });
        return;
      }
    }
    const trace: CallTraceContext = {
      source: "softphone",
      callId: call.sipCallId ?? call.id,
      sessionId,
      dialog,
      rtpStreams: rtpStreams.length > 0 ? rtpStreams : undefined,
      registrationAtCall: opts.registrationAtCall,
      softphoneCall: {
        target: call.target,
        state: call.state,
        startTime: call.startTime,
        endTime: call.endTime,
        statusCode: call.statusCode,
        statusText: call.statusText,
        errorMessage: call.errorMessage,
        requestMessage: call.requestMessage,
        responseMessage: call.responseMessage,
        negotiatedCodec: call.negotiatedCodec,
      },
    };
    const hints = computeRootCauseHints(trace);
    set({ selectedTrace: trace, rootCauseHints: hints, traceError: null, loadingTrace: false });
  },

  clearTrace: () => set({ selectedTrace: null, rootCauseHints: [], traceError: null, loadingTrace: false }),

  setError: (error) => set({ error }),

  setCaptureSessions: (sessions) => set({ captureSessions: sessions }),

  addReceivedFax: (fax) =>
    set((s) => {
      const receivedFaxes = [fax, ...(s.receivedFaxes ?? []).filter((f) => f.id !== fax.id)];
      const entryId = `fax-r-${fax.receivedAt}-${fax.id}`;
      let timeline = s.timeline ?? [];
      if (!timeline.some((e) => e.id === entryId)) {
        timeline = [
          {
            id: entryId,
            timestamp: fax.receivedAt,
            kind: "fax_received" as const,
            label: `Fax from ${fax.sender}`,
            detail: `${fax.pageCount} page(s)`,
            success: fax.session.success,
            refId: fax.id,
          },
          ...timeline,
        ].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        if (timeline.length > MAX_TIMELINE_ENTRIES) {
          timeline = timeline.slice(-MAX_TIMELINE_ENTRIES);
        }
      }
      return { receivedFaxes, timeline };
    }),

  addSentFaxJob: (job) =>
    set((s) => {
      const sentFaxJobs = [job, ...(s.sentFaxJobs ?? []).filter((j) => j.id !== job.id)];
      return { sentFaxJobs };
    }),

  updateSentFaxJob: (id, update) =>
    set((s) => {
      const nextJobs = (s.sentFaxJobs ?? []).map((j) => (j.id === id ? { ...j, ...update } : j));
      const updated = nextJobs.find((j) => j.id === id);
      let timeline = s.timeline ?? [];
      if (
        updated &&
        (updated.status === "sent" || updated.status === "failed") &&
        updated.completedAt
      ) {
        const entryId = `fax-s-${updated.createdAt}-${id}`;
        if (!timeline.some((e) => e.id === entryId)) {
          timeline = [
            ...timeline,
            {
              id: entryId,
              timestamp: updated.completedAt,
              kind: "fax_sent" as const,
              label: `Fax to ${updated.target}`,
              detail: updated.status === "sent" ? `${updated.pageCount} page(s)` : updated.status,
              success: updated.status === "sent",
              refId: id,
            },
          ].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          if (timeline.length > MAX_TIMELINE_ENTRIES) {
            timeline = timeline.slice(-MAX_TIMELINE_ENTRIES);
          }
        }
      }
      return { sentFaxJobs: nextJobs, timeline };
    }),

  removeSentFaxJob: (id) =>
    set((s) => ({
      sentFaxJobs: (s.sentFaxJobs ?? []).filter((j) => j.id !== id),
      faxFolderAssignments: Object.fromEntries(
        Object.entries(s.faxFolderAssignments ?? {}).filter(([key]) => key !== `sent:${id}`),
      ),
      timeline: (s.timeline ?? []).filter((e) => !(e.refId === id && e.kind === "fax_sent")),
    })),

  clearSentFaxJobs: () =>
    set((s) => ({
      sentFaxJobs: [],
      timeline: (s.timeline ?? []).filter((e) => e.kind !== "fax_sent"),
    })),

  removeReceivedFax: (id) =>
    set((s) => ({
      receivedFaxes: (s.receivedFaxes ?? []).filter((f) => f.id !== id),
      faxFolderAssignments: Object.fromEntries(
        Object.entries(s.faxFolderAssignments ?? {}).filter(([key]) => key !== `received:${id}`),
      ),
      timeline: (s.timeline ?? []).filter((e) => !(e.refId === id && e.kind === "fax_received")),
    })),

  createFaxFolder: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "unified") return null;
    const exists = (get().faxFolders ?? []).some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) return null;
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ faxFolders: [...(s.faxFolders ?? []), { id, name: trimmed }] }));
    return id;
  },

  renameFaxFolder: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed) return {};
      if (trimmed.toLowerCase() === "unified") return {};
      const duplicate = (s.faxFolders ?? []).some((folder) => folder.id !== id && folder.name.toLowerCase() === trimmed.toLowerCase());
      if (duplicate) return {};
      return {
        faxFolders: (s.faxFolders ?? []).map((folder) =>
          folder.id === id ? { ...folder, name: trimmed } : folder,
        ),
      };
    }),

  deleteFaxFolder: (id) =>
    set((s) => {
      const nextFolders = (s.faxFolders ?? []).filter((folder) => folder.id !== id);
      const nextAssignments: Record<string, string> = {};
      for (const [key, folderId] of Object.entries(s.faxFolderAssignments ?? {})) {
        if (folderId !== id) nextAssignments[key] = folderId;
      }
      return {
        faxFolders: nextFolders,
        faxFolderAssignments: nextAssignments,
      };
    }),

  assignFaxFolder: (itemKey, folderId) =>
    set((s) => {
      const validFolder = (s.faxFolders ?? []).some((folder) => folder.id === folderId);
      const nextAssignments = { ...(s.faxFolderAssignments ?? {}) };
      if (!validFolder) {
        delete nextAssignments[itemKey];
      } else {
        nextAssignments[itemKey] = folderId;
      }
      return { faxFolderAssignments: nextAssignments };
    }),

}));

function buildTroubleshootingActivityItems(state: TroubleshootingState): ActivityMonitorWorkItem[] {
  const rows: ActivityMonitorWorkItem[] = [];
  for (const fax of state.sentFaxJobs ?? []) {
    if (!(fax.status === "pending" || fax.status === "sending")) continue;
    rows.push({
      key: `fax-${fax.id}`,
      name: `Fax: ${fax.target}`,
      detail: `${fax.status} • ${fax.pageCount} page(s)`,
      state: fax.status === "sending" ? "running" : "warning",
      cpuPct: 10,
      memMb: 90,
      startedAt: fax.createdAt ? new Date(fax.createdAt).getTime() : Date.now() - 10_000,
      kind: "fax",
    });
  }
  if (state.loadingHealth) {
    rows.push({
      key: "agent-health-load",
      name: "Health diagnostics",
      detail: "Loading registration health",
      state: "running",
      cpuPct: 9,
      memMb: 85,
      startedAt: Date.now() - 4_000,
      kind: "agent",
    });
  }
  if (state.loadingTrace) {
    rows.push({
      key: "agent-trace-load",
      name: "Forensic trace analysis",
      detail: "Correlating call + packet traces",
      state: "running",
      cpuPct: 13,
      memMb: 110,
      startedAt: Date.now() - 4_000,
      kind: "agent",
    });
  }
  return rows.slice(0, 40);
}

useTroubleshootingStore.subscribe((state) => {
  useActivityMonitorStore.getState().setSourceItems(
    "troubleshooting-store",
    buildTroubleshootingActivityItems(state),
  );
});
useActivityMonitorStore.getState().setSourceItems(
  "troubleshooting-store",
  buildTroubleshootingActivityItems(useTroubleshootingStore.getState()),
);
