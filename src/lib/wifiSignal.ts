import { WifiHigh, WifiLow, WifiMedium, WifiNone } from "@/lib/icons";

type WifiIconComponent = typeof WifiHigh;
type WifiSample = { signal_quality_pct?: number | null; rssi_dbm?: number | null };

export type WifiTier = "none" | "low" | "medium" | "high";

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function qualityFromRssi(rssiDbm?: number | null): number | null {
  if (typeof rssiDbm !== "number" || !Number.isFinite(rssiDbm)) return null;
  // Match backend normalization for consistency across OSes.
  if (rssiDbm <= -90) return 0;
  if (rssiDbm <= -80) return Math.round(((rssiDbm + 90) / 10) * 25);
  if (rssiDbm <= -70) return Math.round(25 + ((rssiDbm + 80) / 10) * 25);
  if (rssiDbm <= -60) return Math.round(50 + ((rssiDbm + 70) / 10) * 25);
  if (rssiDbm <= -50) return Math.round(75 + ((rssiDbm + 60) / 10) * 15);
  if (rssiDbm <= -40) return Math.round(90 + ((rssiDbm + 50) / 10) * 10);
  return 100;
}

export function resolveWifiQualityPct(
  qualityOrInfo?: number | WifiSample | null,
  rssiDbm?: number | null,
): number | null {
  if (typeof qualityOrInfo === "number") {
    return clampPct(qualityOrInfo);
  }
  if (qualityOrInfo && typeof qualityOrInfo === "object") {
    if (typeof qualityOrInfo.signal_quality_pct === "number" && Number.isFinite(qualityOrInfo.signal_quality_pct)) {
      return clampPct(qualityOrInfo.signal_quality_pct);
    }
    return qualityFromRssi(qualityOrInfo.rssi_dbm);
  }
  if (typeof rssiDbm === "number") {
    return qualityFromRssi(rssiDbm);
  }
  return null;
}

export function wifiTierFromQualityPct(qualityPct?: number | null): WifiTier {
  const pct = resolveWifiQualityPct(qualityPct);
  if (pct == null || pct <= 0) return "none";
  // Calibrated to match common OS Wi-Fi bar behavior.
  if (pct >= 75) return "high";
  if (pct >= 45) return "medium";
  return "low";
}

export function wifiLabelFromQualityPct(qualityPct?: number | null): "Excellent" | "Good" | "Fair" | "Poor" | "Unknown" {
  const pct = resolveWifiQualityPct(qualityPct);
  if (pct == null) return "Unknown";
  if (pct >= 75) return "Excellent";
  if (pct >= 45) return "Good";
  if (pct >= 20) return "Fair";
  return "Poor";
}

export function wifiToneClassFromQualityPct(qualityPct?: number | null): string {
  const pct = resolveWifiQualityPct(qualityPct);
  if (pct == null) return "text-muted-foreground";
  if (pct >= 75) return "text-success";
  if (pct >= 45) return "text-primary";
  if (pct > 0) return "text-warning";
  return "text-destructive";
}

export function wifiIconFromQualityPct(qualityPct?: number | null): WifiIconComponent {
  const tier = wifiTierFromQualityPct(qualityPct);
  // Use a visually consistent Lucide progression in compact header contexts:
  // full wifi (high), partial wifi (medium), minimal wifi (low), off (none).
  if (tier === "high") return WifiMedium;
  if (tier === "medium") return WifiHigh;
  if (tier === "low") return WifiLow;
  return WifiNone;
}

// Backward-compatible aliases for call sites using older names.
export const wifiIconForQuality = wifiIconFromQualityPct;
export const wifiToneClassFromQuality = wifiToneClassFromQualityPct;
export const wifiLabelFromQuality = wifiLabelFromQualityPct;
export const wifiTierFromQuality = wifiTierFromQualityPct;
