/**
 * SIP Discovery API — typed wrappers for sip_discovery backend commands.
 */

import { invokeTauri } from "./invoke";
import type {
  ScanResult,
  ScanMethod,
  ScanTransport,
  DetectedSubnet,
} from "@/types/sipDiscovery";

// ── Scan ─────────────────────────────────────────────────────────

export async function sipDiscoveryScan(
  targets: string,
  ports?: number[],
  transport?: ScanTransport,
  timeoutMs?: number,
  concurrency?: number,
  method?: ScanMethod,
): Promise<ScanResult> {
  return invokeTauri<ScanResult>("sip_discovery_scan", {
    targets,
    ports: ports ?? null,
    transport: transport ?? null,
    timeoutMs: timeoutMs ?? null,
    concurrency: concurrency ?? null,
    method: method ?? null,
  });
}

// ── Stop ─────────────────────────────────────────────────────────

export async function sipDiscoveryStopScan(): Promise<void> {
  return invokeTauri<void>("sip_discovery_stop_scan");
}

// ── Is Running ───────────────────────────────────────────────────

export async function sipDiscoveryIsRunning(): Promise<boolean> {
  return invokeTauri<boolean>("sip_discovery_is_running");
}

// ── Expand Targets (preview) ─────────────────────────────────────

export async function sipDiscoveryExpandTargets(
  input: string,
): Promise<string[]> {
  return invokeTauri<string[]>("sip_discovery_expand_targets", { input });
}

// ── Detect Subnet ────────────────────────────────────────────────

export async function sipDiscoveryDetectSubnet(): Promise<DetectedSubnet> {
  return invokeTauri<DetectedSubnet>("sip_discovery_detect_subnet");
}
