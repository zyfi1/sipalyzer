/**
 * Central VoIP Quality Thresholds — single source of truth for all quality constants.
 *
 * Every value is sourced from published industry standards — zero made-up numbers.
 * Import from here instead of defining local magic numbers.
 *
 * Sources:
 * - ITU-T G.107 (E-Model for MOS calculation)
 * - ITU-T G.114 (One-way delay recommendations)
 * - ITU-T P.800 (MOS subjective quality scale)
 * - ITU-T T.38 (Fax over IP)
 * - RFC 3261 (SIP protocol timers)
 * - RFC 3550 (RTP)
 * - Cisco Voice Quality Design Guide
 * - Cisco T.38 FoIP Design Best Practices
 * - Sansay TAC T.38 Troubleshooting Guide
 */

export const VOIP_THRESHOLDS = {
  mos: {
    // ITU-T P.800, ITU-T G.107 (E-Model)
    excellent: 4.3,     // Very satisfied users (G.107 R > 90)
    good: 4.0,          // Satisfied users (G.107 R > 80)
    fair: 3.6,          // Some users dissatisfied (G.107 R > 70)
    poor: 3.1,          // Many users dissatisfied (G.107 R > 60)
    bad: 1.0,           // Nearly all users dissatisfied
    // Alert thresholds for SIPalyzer UI
    warnBelow: 3.6,     // Yellow alert — fair quality boundary (G.107)
    criticalBelow: 3.1, // Red alert — poor quality boundary (G.107)
  },

  jitter: {
    // Cisco VoIP QoS Design Guide, ITU-T G.114
    excellent: 10,      // ms — optimal for HD voice
    acceptable: 30,     // ms — max for good voice quality
    degraded: 50,       // ms — noticeable quality degradation
    unacceptable: 80,   // ms — severe degradation
    warnAbove: 30,      // ms
    criticalAbove: 50,  // ms
  },

  packetLoss: {
    // Cisco Voice Quality docs, ITU-T G.114
    excellent: 0.5,     // % — imperceptible
    acceptable: 1.0,    // % — max for good G.711 quality
    degraded: 3.0,      // % — noticeable with most codecs
    unacceptable: 5.0,  // % — severe degradation
    warnAbove: 1.0,     // %
    criticalAbove: 3.0, // %
  },

  latency: {
    // ITU-T G.114 recommends < 150ms one-way for voice
    excellent: 80,      // ms one-way — imperceptible
    acceptable: 150,    // ms one-way — G.114 max recommended
    degraded: 250,      // ms one-way — noticeable delay
    unacceptable: 400,  // ms one-way — conversation breakdown
    warnAbove: 150,     // ms one-way
    criticalAbove: 300, // ms one-way
  },

  t38: {
    // Cisco T.38 FoIP Design Guide, Sansay TAC
    maxDelay: 1000,            // ms — max one-way for T.38
    maxJitter: 300,            // ms — T.38 UDPTL tolerance
    maxJitterPassthrough: 30,  // ms — G.711 passthrough fax
    normalFailRate: 8,         // % — normal failure rate on SIP trunks (Sansay TAC)
  },

  bandwidth: {
    // Per concurrent call with IP/UDP/RTP overhead at 20ms ptime (Cisco bandwidth calc)
    g711Kbps: 87.2,     // kbps — G.711 (64kbps codec + headers)
    g729Kbps: 31.2,     // kbps — G.729 (8kbps codec + headers)
    overheadBytes: 58,  // bytes — IP(20) + UDP(8) + RTP(12) + Ethernet(18) per packet (Cisco doc 7934)
  },

  rtp: {
    defaultPtimeMs: 20,    // ms — standard packet interval (RFC 3550)
    portRangeMin: 10000,   // IANA ephemeral, industry convention
    portRangeMax: 20000,   // upper bound for firewall rules
  },

  sip: {
    defaultPort: 5060,     // RFC 3261
    tlsPort: 5061,         // RFC 3261
    timerT1Ms: 500,        // ms — RFC 3261 S17.1.1.1 (RTT estimate)
    timerT2Ms: 4000,       // ms — RFC 3261 S17.1.2.2 (max retransmit interval)
    timerBMs: 32000,       // ms — 64*T1, INVITE transaction timeout (RFC 3261)
    timerFMs: 32000,       // ms — 64*T1, non-INVITE transaction timeout (RFC 3261)
    timerDMs: 32000,       // ms — wait time for response retransmits (RFC 3261)
    maxForwards: 70,       // RFC 3261 S8.1.1.6
    defaultExpiresSec: 3600, // seconds — RFC 3261 S10.2
  },

  eModel: {
    // ITU-T G.107 E-Model constants for R-factor / MOS calculation
    r0: 93.2,                          // Basic signal-to-noise ratio (wideband)
    delayImpairmentThresholdMs: 177.3, // ms — Id calculation threshold
    g711PacketLossRobustness: 25.0,    // Bpl for G.711
    g729PacketLossRobustness: 19.0,    // Bpl for G.729
  },
} as const;

// ── Helper functions ──

export type QualityTier = "excellent" | "good" | "fair" | "poor" | "bad" | "unknown";

/** Classify MOS score into a quality tier (ITU-T G.107 / P.800). */
export function mosTier(mos: number | null | undefined): QualityTier {
  if (mos == null) return "unknown";
  if (mos >= VOIP_THRESHOLDS.mos.excellent) return "excellent";
  if (mos >= VOIP_THRESHOLDS.mos.good) return "good";
  if (mos >= VOIP_THRESHOLDS.mos.fair) return "fair";
  if (mos >= VOIP_THRESHOLDS.mos.poor) return "poor";
  return "bad";
}

/** Classify jitter (ms) into a quality tier (Cisco VoIP QoS Design Guide). */
export function jitterTier(jitterMs: number | null | undefined): QualityTier {
  if (jitterMs == null) return "unknown";
  if (jitterMs <= VOIP_THRESHOLDS.jitter.excellent) return "excellent";
  if (jitterMs <= VOIP_THRESHOLDS.jitter.acceptable) return "good";
  if (jitterMs <= VOIP_THRESHOLDS.jitter.degraded) return "fair";
  return "poor";
}

/** Classify packet loss (%) into a quality tier (Cisco Voice Quality docs). */
export function lossTier(lossPercent: number | null | undefined): QualityTier {
  if (lossPercent == null) return "unknown";
  if (lossPercent <= VOIP_THRESHOLDS.packetLoss.excellent) return "excellent";
  if (lossPercent <= VOIP_THRESHOLDS.packetLoss.acceptable) return "good";
  if (lossPercent <= VOIP_THRESHOLDS.packetLoss.degraded) return "fair";
  return "poor";
}

/** Classify one-way latency (ms) into a quality tier (ITU-T G.114). */
export function latencyTier(latencyMs: number | null | undefined): QualityTier {
  if (latencyMs == null) return "unknown";
  if (latencyMs <= VOIP_THRESHOLDS.latency.excellent) return "excellent";
  if (latencyMs <= VOIP_THRESHOLDS.latency.acceptable) return "good";
  if (latencyMs <= VOIP_THRESHOLDS.latency.degraded) return "fair";
  return "poor";
}

/** Returns true if the metric value exceeds its warning threshold. */
export function isMetricWarning(metric: "mos" | "jitter" | "loss" | "latency", value: number): boolean {
  switch (metric) {
    case "mos": return value < VOIP_THRESHOLDS.mos.warnBelow;
    case "jitter": return value > VOIP_THRESHOLDS.jitter.warnAbove;
    case "loss": return value > VOIP_THRESHOLDS.packetLoss.warnAbove;
    case "latency": return value > VOIP_THRESHOLDS.latency.warnAbove;
  }
}

/** Returns true if the metric value exceeds its critical threshold. */
export function isMetricCritical(metric: "mos" | "jitter" | "loss" | "latency", value: number): boolean {
  switch (metric) {
    case "mos": return value < VOIP_THRESHOLDS.mos.criticalBelow;
    case "jitter": return value > VOIP_THRESHOLDS.jitter.criticalAbove;
    case "loss": return value > VOIP_THRESHOLDS.packetLoss.criticalAbove;
    case "latency": return value > VOIP_THRESHOLDS.latency.criticalAbove;
  }
}
