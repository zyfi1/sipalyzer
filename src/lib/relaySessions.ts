import type { GeneratedConfig } from "@/stores/remoteAgentStore";

export interface RelayRestoreTarget {
  agentId: string;
  sessionId: string;
  authToken: string;
}

export function relaySessionIdFromControllerAddress(controllerAddress: string): string | null {
  const match = controllerAddress.match(/\/session\/([^/?#|]+)/i);
  return match?.[1] ?? null;
}

export function buildRelayRestorePlan(
  configs: GeneratedConfig[],
  onlyAgentId?: string,
): RelayRestoreTarget[] {
  const seenSessions = new Set<string>();
  const targets: RelayRestoreTarget[] = [];

  for (const cfg of configs) {
    if (onlyAgentId && cfg.agentId !== onlyAgentId) continue;
    const sessionId = relaySessionIdFromControllerAddress(cfg.controllerAddress);
    if (!sessionId || seenSessions.has(sessionId)) continue;
    seenSessions.add(sessionId);
    targets.push({
      agentId: cfg.agentId,
      sessionId,
      authToken: cfg.authToken,
    });
  }

  return targets;
}
