export const VOIP_QUALITY_THRESHOLDS = {
  mos: {
    good: 4.0,
    fair: 3.6,
    warning: 3.6,
    critical: 3.0,
  },
  lossPct: {
    excellent: 0.5,
    veryLow: 1.0,
    low: 3.0,
    moderate: 5.0,
    high: 10.0,
    warning: 3.0,
    critical: 5.0,
  },
  jitterMs: {
    low: 20,
    moderate: 40,
    typicalBuffer: 60,
    warning: 70,
    critical: 100,
  },
  packetCount: {
    minimumContext: 100,
  },
} as const;

