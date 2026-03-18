import type { SipDialog, SipDialogMessage } from "@/types/forensics";
import type { RtpStreamInfo } from "@/types/packetCapture";
import type { DiagnosticsFinding, DiagnosticsInput } from "@/types/diagnostics";
import { VOIP_QUALITY_THRESHOLDS } from "@/lib/voipQualityThresholds";

interface BuildCtx {
  nowIso: string;
}

function asCode(methodOrCode: string): number | null {
  const match = methodOrCode.trim().match(/^(\d{3})/);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "", 10);
}

function parseCseqMethod(cseq?: string): string | null {
  if (!cseq) return null;
  const parts = cseq.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const method = parts[1];
  return method ? method.toUpperCase() : null;
}

function parseCseqNumber(cseq?: string): number | null {
  if (!cseq) return null;
  const parts = cseq.trim().split(/\s+/);
  if (parts.length < 1) return null;
  const n = Number.parseInt(parts[0] ?? "", 10);
  return Number.isNaN(n) ? null : n;
}

function hasMethod(dialog: SipDialog, method: string): boolean {
  const upper = method.toUpperCase();
  return dialog.messages.some((m) => m.methodOrCode.trim().toUpperCase() === upper);
}

interface MethodResponse {
  code: number;
  method: string;
  cseqNumber: number | null;
  packetIndex: number;
  timestamp: string;
}

function getMethodResponses(dialog: SipDialog): MethodResponse[] {
  let currentRequestMethod: string | null = null;
  let currentRequestCseqNumber: number | null = null;
  const out: MethodResponse[] = [];
  for (const message of dialog.messages) {
    const code = asCode(message.methodOrCode);
    if (code === null) {
      currentRequestMethod = message.methodOrCode.trim().toUpperCase();
      currentRequestCseqNumber = parseCseqNumber(message.cseq);
      continue;
    }
    const method = parseCseqMethod(message.cseq) ?? currentRequestMethod ?? "UNKNOWN";
    const cseqNumber = parseCseqNumber(message.cseq) ?? currentRequestCseqNumber;
    out.push({
      code,
      method,
      cseqNumber,
      packetIndex: message.packetIndex,
      timestamp: message.timestamp,
    });
  }
  return out;
}

interface SipTransaction {
  method: string;
  cseqNumber: number | null;
  branchToken: string | null;
  requestPacketIndex: number;
  responses: MethodResponse[];
}

function parseBranchFromVia(value: string): string | null {
  const match = value.match(/;\s*branch=([^;\s]+)/i);
  return match ? (match[1] ?? null) : null;
}

function extractBranchToken(message: SipDialogMessage): string | null {
  const m = message as SipDialogMessage & Record<string, unknown>;
  const direct = [
    m.viaBranch,
    m.branch,
    m.topViaBranch,
  ].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (direct) return direct.trim();

  const viaLike = [
    m.via,
    m.topVia,
  ].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (viaLike) return parseBranchFromVia(viaLike);

  // Some backends may pack it into CSeq-like or debug fields.
  if (typeof m.cseq === "string") {
    const embedded = m.cseq.match(/branch=([^;\s]+)/i);
    if (embedded?.[1]) return embedded[1];
  }
  return null;
}

function buildTransactions(dialog: SipDialog): SipTransaction[] {
  const transactions: SipTransaction[] = [];
  const byKey = new Map<string, SipTransaction>();
  let currentRequestMethod: string | null = null;
  let currentRequestCseqNumber: number | null = null;
  let currentRequestBranch: string | null = null;

  for (const message of dialog.messages) {
    const code = asCode(message.methodOrCode);
    if (code === null) {
      const method = message.methodOrCode.trim().toUpperCase();
      const cseqNumber = parseCseqNumber(message.cseq);
      const branchToken = extractBranchToken(message);
      currentRequestMethod = method;
      currentRequestCseqNumber = cseqNumber;
      currentRequestBranch = branchToken;
      const tx: SipTransaction = {
        method,
        cseqNumber,
        branchToken,
        requestPacketIndex: message.packetIndex,
        responses: [],
      };
      transactions.push(tx);
      byKey.set(`${method}:${cseqNumber ?? "na"}:${branchToken ?? "na"}`, tx);
      continue;
    }

    const method = parseCseqMethod(message.cseq) ?? currentRequestMethod;
    const cseqNumber = parseCseqNumber(message.cseq) ?? currentRequestCseqNumber;
    const branchToken = extractBranchToken(message) ?? currentRequestBranch;
    const key = `${method ?? "UNKNOWN"}:${cseqNumber ?? "na"}:${branchToken ?? "na"}`;
    const tx = byKey.get(key);
    if (tx) {
      tx.responses.push({
        code,
        method: method ?? tx.method,
        cseqNumber,
        packetIndex: message.packetIndex,
        timestamp: message.timestamp,
      });
      continue;
    }

    // Fallback: attach to latest matching method transaction when possible.
    if (method) {
      const fallback = [...transactions]
        .reverse()
        .find((t) => t.method === method && t.cseqNumber === cseqNumber);
      if (fallback) {
        fallback.responses.push({
          code,
          method,
          cseqNumber,
          packetIndex: message.packetIndex,
          timestamp: message.timestamp,
        });
      }
    }
  }
  return transactions;
}

function finalResponse(tx: SipTransaction): MethodResponse | null {
  const finals = tx.responses.filter((r) => r.code >= 200);
  return finals.length > 0 ? finals[finals.length - 1] ?? null : null;
}

function toMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

interface SipKpis {
  authRetriesInvite: number;
  authRetriesRegister: number;
  inviteProvisionalDepth: number;
  inviteForkBranchCount: number;
  inviteSetupLatencyMs: number | null;
}

function buildSipKpis(dialog: SipDialog, transactions: SipTransaction[], methodResponses: MethodResponse[]): SipKpis {
  const inviteResponses = methodResponses.filter((r) => r.method === "INVITE");
  const registerResponses = methodResponses.filter((r) => r.method === "REGISTER");
  const inviteChallenges = inviteResponses.filter((r) => AUTH_CHALLENGE_CODES.has(r.code)).length;
  const registerChallenges = registerResponses.filter((r) => AUTH_CHALLENGE_CODES.has(r.code)).length;
  const inviteProvisionalDepth = inviteResponses.filter((r) => r.code >= 100 && r.code < 200).length;
  const inviteTransactions = transactions.filter((t) => t.method === "INVITE");
  const inviteForkBranchCount = new Set(
    inviteTransactions
      .map((t) => t.branchToken)
      .filter((b): b is string => typeof b === "string" && b.length > 0),
  ).size;

  const firstInvite = dialog.messages.find((m) => m.methodOrCode.trim().toUpperCase() === "INVITE");
  const finalInvite = [...inviteTransactions]
    .map(finalResponse)
    .filter((r): r is MethodResponse => r !== null)
    .at(-1) ?? null;
  const start = toMs(firstInvite?.timestamp);
  const end = toMs(finalInvite?.timestamp);
  const inviteSetupLatencyMs = start !== null && end !== null && end >= start ? end - start : null;

  return {
    authRetriesInvite: inviteChallenges,
    authRetriesRegister: registerChallenges,
    inviteProvisionalDepth,
    inviteForkBranchCount,
    inviteSetupLatencyMs,
  };
}

const AUTH_CHALLENGE_CODES = new Set([401, 407]);
const BENIGN_TERMINAL_CODES = new Set([487]);
const CONTEXTUAL_CODES = new Set([480, 486, 600, 603, 302, 380]);

function analyzeSip(dialogs: SipDialog[], ctx: BuildCtx): DiagnosticsFinding[] {
  const findings: DiagnosticsFinding[] = [];
  for (const dialog of dialogs) {
    const transactions = buildTransactions(dialog);
    const methodResponses = getMethodResponses(dialog);
    const kpis = buildSipKpis(dialog, transactions, methodResponses);
    const hasInvite = hasMethod(dialog, "INVITE");
    const hasCancel = hasMethod(dialog, "CANCEL");
    const inviteTransactions = transactions.filter((t) => t.method === "INVITE");
    const registerTransactions = transactions.filter((t) => t.method === "REGISTER");
    const inviteResponses = methodResponses.filter((r) => r.method === "INVITE");
    const registerResponses = methodResponses.filter((r) => r.method === "REGISTER");
    const hasInviteSuccess = inviteResponses.some((r) => r.code >= 200 && r.code < 300);
    const hasRegisterSuccess = registerResponses.some((r) => r.code >= 200 && r.code < 300);
    const challenges = methodResponses.filter((r) => AUTH_CHALLENGE_CODES.has(r.code));

    // Real-world auth flow: 401/407 challenge followed by 200 OK is normal.
    const successfulAuthFlowByMethod: Record<"INVITE" | "REGISTER", boolean> = {
      INVITE: false,
      REGISTER: false,
    };
    for (const method of ["INVITE", "REGISTER"] as const) {
      const txs = method === "INVITE" ? inviteTransactions : registerTransactions;
      const seqGroups = new Map<string, SipTransaction[]>();
      for (const tx of txs) {
        const key = String(tx.cseqNumber ?? "na");
        if (!seqGroups.has(key)) seqGroups.set(key, []);
        seqGroups.get(key)?.push(tx);
      }
      for (const [, group] of seqGroups) {
        const finals = group.map(finalResponse).filter((r): r is MethodResponse => r !== null);
        const hasChallenge = finals.some((f) => AUTH_CHALLENGE_CODES.has(f.code));
        const hasSuccess = finals.some((f) => f.code >= 200 && f.code < 300);
        if (hasChallenge && hasSuccess) {
          successfulAuthFlowByMethod[method] = true;
        }
      }
    }

    // Explicitly handle auth loops as an issue (per method family).
    for (const method of ["INVITE", "REGISTER"] as const) {
      const methodChallenges = challenges.filter((c) => c.method === method);
      const methodSuccess = method === "INVITE" ? hasInviteSuccess : hasRegisterSuccess;
      if (methodChallenges.length >= 3 && !methodSuccess) {
        const lastChallenge = methodChallenges[methodChallenges.length - 1];
        if (!lastChallenge) continue;
        findings.push({
          id: `sip-auth-loop-${method.toLowerCase()}-${dialog.callId}-${lastChallenge.packetIndex}`,
          ruleId: "sip_auth_challenge_loop",
          domain: "sip",
          category: "security",
          severity: "critical",
          confidenceScore: 0.93,
          title: `SIP ${method} authentication challenge loop`,
          description: `Repeated 401/407 authentication challenges occurred for ${method} without successful completion.`,
          relatedCallId: dialog.callId,
          firstSeen: dialog.startTime ?? ctx.nowIso,
          lastSeen: dialog.endTime ?? ctx.nowIso,
          evidence: [
            {
              id: `pkt-${lastChallenge.packetIndex}`,
              type: "packet",
              label: "Latest auth challenge",
              value: `Packet #${lastChallenge.packetIndex}`,
              packetIndices: [lastChallenge.packetIndex],
            },
            {
              id: `auth-retries-${method.toLowerCase()}-${dialog.callId}`,
              type: "metric",
              label: `${method} auth retries`,
              value: String(methodChallenges.length),
            },
          ],
          remediation: { id: "sip-auth-loop-verify", title: "Compare auth realm and challenge continuity" },
        });
      }
    }
    // If INVITE auth challenge succeeded, do not treat challenge outcomes as failures.
    const suppressInviteChallengeFailure = successfulAuthFlowByMethod.INVITE;
    const inviteFinals = inviteTransactions.map(finalResponse).filter((r): r is MethodResponse => r !== null);
    const inviteSuccessfulBranch = inviteFinals.some((r) => r.code >= 200 && r.code < 300);

    // INVITE started but no final response can indicate timeout/routing issues.
    const inviteFinal = inviteFinals.at(-1) ?? null;
    if (hasInvite && !inviteFinal) {
      // CANCEL with no final INVITE is often expected call abort behavior.
      if (hasCancel) continue;
      findings.push({
        id: `sip-invite-no-final-${dialog.callId}-${dialog.startTime ?? ctx.nowIso}`,
        ruleId: "sip_invite_no_final_response",
        domain: "sip",
        category: "signaling",
        severity: "warning",
        confidenceScore: 0.68,
        title: "No final SIP response observed",
        description: "INVITE did not receive a final SIP response (2xx-6xx) in this dialog window.",
        relatedCallId: dialog.callId,
        firstSeen: dialog.startTime ?? ctx.nowIso,
        lastSeen: dialog.endTime ?? ctx.nowIso,
        evidence: [],
        remediation: { id: "sip-timeout-correlation", title: "Compare timeout pattern across adjacent dialogs" },
      });
      continue;
    }

    if (!inviteFinal || (inviteFinal.code >= 200 && inviteFinal.code < 300)) continue;
    // In forked/multi-branch call setup, any successful INVITE branch means setup succeeded.
    if (inviteSuccessfulBranch) continue;
    if (suppressInviteChallengeFailure && AUTH_CHALLENGE_CODES.has(inviteFinal.code)) continue;

    // Benign terminal events should not be surfaced as issues.
    if (BENIGN_TERMINAL_CODES.has(inviteFinal.code)) {
      // 487 is especially expected when CANCEL is present.
      if (inviteFinal.code === 487 && hasCancel) continue;
      continue;
    }

    // Contextual terminal events (busy/decline/redirect) are informational, not errors.
    const severity =
      inviteFinal.code >= 500
        ? "critical"
        : CONTEXTUAL_CODES.has(inviteFinal.code)
          ? "info"
          : "warning";

    findings.push({
      id: `sip-final-${dialog.callId}-${inviteFinal.code}-${inviteFinal.packetIndex}`,
      ruleId: "sip_final_non_2xx",
      domain: "sip",
      category: "signaling",
      severity,
      confidenceScore: severity === "info" ? 0.7 : 0.88,
      title: `SIP ${inviteFinal.code} final response`,
      description:
        severity === "info"
          ? `Dialog ended with SIP ${inviteFinal.code}, which is contextual and may be expected for this call path.`
          : `Call dialog ended with final SIP response ${inviteFinal.code}.`,
      relatedCallId: dialog.callId,
      firstSeen: dialog.startTime ?? ctx.nowIso,
      lastSeen: dialog.endTime ?? ctx.nowIso,
      evidence: [
        {
          id: `pkt-${inviteFinal.packetIndex}`,
          type: "packet",
          label: "Final SIP response packet",
          value: `Packet #${inviteFinal.packetIndex}`,
          packetIndices: [inviteFinal.packetIndex],
        },
        {
          id: `kpi-provisional-${dialog.callId}`,
          type: "metric",
          label: "INVITE provisional depth",
          value: String(kpis.inviteProvisionalDepth),
        },
        {
          id: `kpi-auth-retries-invite-${dialog.callId}`,
          type: "metric",
          label: "INVITE auth retries",
          value: String(kpis.authRetriesInvite),
        },
        {
          id: `kpi-auth-retries-register-${dialog.callId}`,
          type: "metric",
          label: "REGISTER auth retries",
          value: String(kpis.authRetriesRegister),
        },
        {
          id: `kpi-fork-branches-${dialog.callId}`,
          type: "metric",
          label: "INVITE fork branches",
          value: String(kpis.inviteForkBranchCount),
        },
        ...(kpis.inviteSetupLatencyMs !== null
          ? [
              {
                id: `kpi-setup-latency-${dialog.callId}`,
                type: "metric" as const,
                label: "INVITE setup latency",
                value: `${kpis.inviteSetupLatencyMs}ms`,
              },
            ]
          : []),
      ],
      remediation: { id: "sip-final-code-review", title: "Review SIP final response pattern" },
    });
  }
  return findings;
}

function analyzeRtp(streams: RtpStreamInfo[], ctx: BuildCtx): DiagnosticsFinding[] {
  const findings: DiagnosticsFinding[] = [];
  for (const stream of streams) {
    const streamKey = `${stream.srcIp}:${stream.srcPort}->${stream.dstIp}:${stream.dstPort}`;
    if (stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.warning) {
      findings.push({
        id: `rtp-mos-${stream.ssrc}-${stream.srcIp}-${stream.srcPort}-${stream.dstIp}-${stream.dstPort}`,
        ruleId: "rtp_low_mos",
        domain: "rtp",
        category: "media",
        severity: stream.mosScore < VOIP_QUALITY_THRESHOLDS.mos.critical ? "critical" : "warning",
        confidenceScore: 0.9,
        title: "Low RTP MOS score",
        description: `Observed MOS ${stream.mosScore.toFixed(2)} on stream ${streamKey}.`,
        firstSeen: stream.firstPacketTime ?? ctx.nowIso,
        lastSeen: stream.lastPacketTime ?? ctx.nowIso,
        evidence: [
          {
            id: `ssrc-${stream.ssrc}`,
            type: "rtp_stream",
            label: "RTP stream",
            value: streamKey,
          },
          {
            id: `mos-${stream.ssrc}`,
            type: "metric",
            label: "MOS",
            value: stream.mosScore.toFixed(2),
          },
        ],
        remediation: { id: "rtp-mos-trend", title: "Compare MOS trend and directional symmetry" },
      });
    }
    // Many endpoints run jitter buffers around 60 ms.
    // Keep findings conservative to avoid flagging borderline values.
    if (stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.warning) {
      findings.push({
        id: `rtp-jitter-${stream.ssrc}-${stream.srcIp}-${stream.srcPort}-${stream.dstIp}-${stream.dstPort}`,
        ruleId: "rtp_high_jitter",
        domain: "rtp",
        category: "media",
        severity: stream.jitter >= VOIP_QUALITY_THRESHOLDS.jitterMs.critical ? "critical" : "warning",
        confidenceScore: 0.86,
        title: "High RTP jitter",
        description: `Observed jitter ${stream.jitter.toFixed(0)}ms on stream ${streamKey}.`,
        firstSeen: stream.firstPacketTime ?? ctx.nowIso,
        lastSeen: stream.lastPacketTime ?? ctx.nowIso,
        evidence: [
          {
            id: `jitter-${stream.ssrc}`,
            type: "metric",
            label: "Jitter",
            value: `${stream.jitter.toFixed(0)}ms`,
          },
        ],
        remediation: { id: "rtp-jitter-directional", title: "Compare directional jitter and loss" },
      });
    }
    if (stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.warning) {
      findings.push({
        id: `rtp-loss-${stream.ssrc}-${stream.srcIp}-${stream.srcPort}-${stream.dstIp}-${stream.dstPort}`,
        ruleId: "rtp_packet_loss",
        domain: "rtp",
        category: "network",
        severity: stream.lossPercentage >= VOIP_QUALITY_THRESHOLDS.lossPct.critical ? "critical" : "warning",
        confidenceScore: 0.84,
        title: "Elevated RTP packet loss",
        description: `Observed packet loss ${stream.lossPercentage.toFixed(2)}% on stream ${streamKey}.`,
        firstSeen: stream.firstPacketTime ?? ctx.nowIso,
        lastSeen: stream.lastPacketTime ?? ctx.nowIso,
        evidence: [
          {
            id: `loss-${stream.ssrc}`,
            type: "metric",
            label: "Packet loss",
            value: `${stream.lossPercentage.toFixed(2)}%`,
          },
        ],
        remediation: { id: "network-loss-path", title: "Compare path quality over call interval" },
      });
    }
  }
  return findings;
}

function analyzeFax(dialogs: SipDialog[], ctx: BuildCtx): DiagnosticsFinding[] {
  const findings: DiagnosticsFinding[] = [];
  for (const dialog of dialogs) {
    const hasT38 = dialog.messages.some((m) => /t38/i.test(m.methodOrCode));
    const has488 = dialog.messages.some((m) => m.methodOrCode.trim().startsWith("488"));
    if (hasT38 || has488) {
      findings.push({
      id: `fax-negotiation-${dialog.callId}-${dialog.startTime ?? ctx.nowIso}`,
        ruleId: "fax_t38_negotiation",
        domain: "fax",
        category: "fax",
        severity: has488 ? "warning" : "info",
        confidenceScore: 0.7,
        title: "Fax negotiation pattern detected",
        description: has488
          ? "Fax signaling indicates codec/media negotiation fallback behavior."
          : "T.38 signaling detected in call flow.",
        relatedCallId: dialog.callId,
        firstSeen: dialog.startTime ?? ctx.nowIso,
        lastSeen: dialog.endTime ?? ctx.nowIso,
        evidence: [],
        remediation: { id: "fax-negotiation-compare", title: "Compare T.38 and fallback signaling sequence" },
      });
    }
  }
  return findings;
}

function analyzeUcaas(input: DiagnosticsInput, ctx: BuildCtx): DiagnosticsFinding[] {
  const findings: DiagnosticsFinding[] = [];
  const sessionName = input.session.name.toLowerCase();
  const looksManaged = sessionName.includes("teams") || sessionName.includes("zoom") || sessionName.includes("ucaas");
  if (!looksManaged) return findings;

  findings.push({
    id: `ucaas-context-${input.session.id}`,
    ruleId: "ucaas_context_observed",
    domain: "ucaas",
    category: "performance",
    severity: "info",
    confidenceScore: 0.6,
    title: "UCaaS context detected",
    description: "Session metadata suggests UCaaS traffic context for this analysis window.",
    firstSeen: input.session.startTime ?? ctx.nowIso,
    lastSeen: input.session.endTime ?? ctx.nowIso,
    evidence: [
      {
        id: `session-${input.session.id}`,
        type: "session",
        label: "Session name",
        value: input.session.name,
      },
    ],
  });
  return findings;
}

function correlate(findings: DiagnosticsFinding[], ctx: BuildCtx): DiagnosticsFinding[] {
  const hasSipFailure = findings.some((f) => f.domain === "sip" && (f.severity === "warning" || f.severity === "critical"));
  const hasNetworkOrMedia = findings.some((f) => f.domain === "rtp" && f.category !== "media");
  if (!hasSipFailure || !hasNetworkOrMedia) return [];
  return [
    {
      id: `corr-sip-network-${findings
        .filter((f) => f.domain === "sip" || f.domain === "rtp")
        .map((f) => f.id)
        .sort()
        .join("-")
        .slice(0, 64)}`,
      ruleId: "correlation_sip_network",
      domain: "cross_domain",
      category: "network",
      severity: "warning",
      confidenceScore: 0.72,
      title: "Cross-domain signaling and path correlation",
      description: "Signaling failures and media/network degradation overlap in this analysis window.",
      firstSeen: ctx.nowIso,
      lastSeen: ctx.nowIso,
      evidence: [],
      remediation: { id: "cross-domain-window-compare", title: "Compare signaling and media trend windows" },
    },
  ];
}

export function runDomainAnalyzers(input: DiagnosticsInput): DiagnosticsFinding[] {
  const ctx: BuildCtx = { nowIso: input.session.startTime || "1970-01-01T00:00:00.000Z" };
  const findings = [
    ...analyzeSip(input.dialogs, ctx),
    ...analyzeRtp(input.rtpStreams, ctx),
    ...analyzeFax(input.dialogs, ctx),
    ...analyzeUcaas(input, ctx),
  ];
  return [...findings, ...correlate(findings, ctx)];
}

