/**
 * Network Devices API — typed wrappers for network_devices backend commands.
 */

import { invokeTauri } from "./invoke";
import type {
  ScanResult,
  ScanMethod,
  ScanTransport,
  ScanMode,
  ScanEnrichmentPreset,
  ScanEnrichmentFlags,
  DetectedSubnet,
  SubnetInfo,
} from "@/types/networkDevices";

// ── Scan ─────────────────────────────────────────────────────────

export async function networkDevicesScan(
  targets: string,
  ports?: number[],
  transport?: ScanTransport,
  timeoutMs?: number,
  concurrency?: number,
  method?: ScanMethod,
  scanMode?: ScanMode,
  enrichmentPreset?: ScanEnrichmentPreset,
  enrichmentFlags?: Partial<ScanEnrichmentFlags>,
): Promise<ScanResult> {
  return invokeTauri<ScanResult>("network_devices_scan", {
    targets,
    ports: ports ?? null,
    transport: transport ?? null,
    timeoutMs: timeoutMs ?? null,
    concurrency: concurrency ?? null,
    method: method ?? null,
    scanMode: scanMode ?? null,
    enrichmentPreset: enrichmentPreset ?? null,
    enrichmentFlags: enrichmentFlags ?? null,
  });
}

// ── Stop ─────────────────────────────────────────────────────────

export async function networkDevicesStopScan(): Promise<void> {
  return invokeTauri<void>("network_devices_stop_scan");
}

// ── Is Running ───────────────────────────────────────────────────

export async function networkDevicesIsRunning(): Promise<boolean> {
  return invokeTauri<boolean>("network_devices_is_running");
}

// ── Expand Targets (preview) ─────────────────────────────────────

export async function networkDevicesExpandTargets(
  input: string,
): Promise<string[]> {
  return invokeTauri<string[]>("network_devices_expand_targets", { input });
}

// ── Detect Subnet ────────────────────────────────────────────────

export async function networkDevicesDetectSubnet(): Promise<DetectedSubnet> {
  return invokeTauri<DetectedSubnet>("network_devices_detect_subnet");
}

// ── List all subnets across all interfaces ───────────────────────

export async function networkDevicesListSubnets(): Promise<SubnetInfo[]> {
  return invokeTauri<SubnetInfo[]>("network_devices_list_subnets");
}

// ── Wake-on-LAN ──────────────────────────────────────────────────

export async function networkDevicesWakeOnLan(mac: string): Promise<void> {
  return invokeTauri<void>("network_devices_wake_on_lan", { mac });
}

// ── OUI Lookup ───────────────────────────────────────────────────

export interface OuiLookupResult {
  mac: string;
  prefix: string;
  vendor: string | null;
}

export async function networkDevicesOuiLookup(mac: string): Promise<OuiLookupResult> {
  return invokeTauri<OuiLookupResult>("network_devices_oui_lookup", { mac });
}

export async function networkDevicesOuiLookupBatch(macs: string[]): Promise<OuiLookupResult[]> {
  return invokeTauri<OuiLookupResult[]>("network_devices_oui_lookup_batch", { macs });
}
