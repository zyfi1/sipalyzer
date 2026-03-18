import { useEffect, useMemo, useRef } from "react";
import { useHomeStore } from "@/stores/homeStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useTroubleshootingStore } from "@/stores/troubleshootingStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNetworkTestStore } from "@/stores/networkTestStore";

type TestStatus = "idle" | "running" | "done" | "error";

interface TriggerSnapshot {
  runningSessionIds: Set<string>;
  callStates: Map<string, string>;
  sentFaxStates: Map<string, string>;
  receivedFaxCount: number;
  latestRegistrationResultAt: number;
  networkStatuses: Record<string, TestStatus>;
  networkFlags: {
    bulkRunning: boolean;
    voipRunning: boolean;
    monitorRunning: boolean;
    routeComparing: boolean;
  };
}

const ACTIVE_CALL_STATES = new Set(["connecting", "ringing", "active", "on-hold"]);

function isActiveCallState(state?: string): boolean {
  return !!state && ACTIVE_CALL_STATES.has(state);
}

function latestRegistrationTimestamp(results: Record<string, { timestamp?: string }>): number {
  let latest = 0;
  for (const result of Object.values(results)) {
    if (!result?.timestamp) continue;
    const ts = new Date(result.timestamp).getTime();
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest;
}

function countRunningNetworkTests(
  statuses: Record<string, TestStatus>,
  flags: TriggerSnapshot["networkFlags"],
): number {
  let total = 0;
  for (const value of Object.values(statuses)) {
    if (value === "running") total += 1;
  }
  if (flags.bulkRunning) total += 1;
  if (flags.voipRunning) total += 1;
  if (flags.monitorRunning) total += 1;
  if (flags.routeComparing) total += 1;
  return total;
}

export function useHomeModeTriggers() {
  const homeMode = useHomeStore((s) => s.homeMode);
  const showDashboard = useHomeStore((s) => s.showDashboard);

  const sessions = usePacketCaptureStore((s) => s.sessions);
  const calls = useSoftphoneStore((s) => s.calls);
  const sentFaxJobs = useTroubleshootingStore((s) => s.sentFaxJobs);
  const receivedFaxes = useTroubleshootingStore((s) => s.receivedFaxes);
  const registrationResults = useRegistrationStore((s) => s.testResults);

  const networkStatuses = useNetworkTestStore((s) => ({
    healthCheck: s.healthCheck.status,
    ping: s.ping.status,
    traceroute: s.traceroute.status,
    mtu: s.mtu.status,
    dns: s.dns.status,
    portScan: s.portScan.status,
    stun: s.stun.status,
    jitterTest: s.jitterTest.status,
    packetLossTest: s.packetLossTest.status,
    bandwidthTest: s.bandwidthTest.status,
    turnTest: s.turnTest.status,
    rtpSim: s.rtpSim.status,
    voipPing: s.voipPing.status,
    voipPortScan: s.voipPortScan.status,
    voipDns: s.voipDns.status,
    voipDscp: s.voipDscp.status,
    voipStun: s.voipStun.status,
    stunQuality: s.stunQuality.status,
    sipProbe: s.sipProbe.status,
    speedTest: s.speedTest.status,
  }));
  const networkFlags = useNetworkTestStore((s) => ({
    bulkRunning: s.bulkRunning,
    voipRunning: s.voipRunning,
    monitorRunning: s.monitorRunning,
    routeComparing: s.routeComparing,
  }));

  const snapshot = useMemo<TriggerSnapshot>(() => {
    const runningSessionIds = new Set(
      sessions
        .filter((s) => String(s.status).toLowerCase() === "running")
        .map((s) => s.id),
    );
    const callStates = new Map(calls.map((c) => [c.id, c.state]));
    const sentFaxStates = new Map(sentFaxJobs.map((job) => [job.id, job.status]));
    const latestRegistrationResultAt = latestRegistrationTimestamp(registrationResults);
    return {
      runningSessionIds,
      callStates,
      sentFaxStates,
      receivedFaxCount: receivedFaxes.length,
      latestRegistrationResultAt,
      networkStatuses,
      networkFlags,
    };
  }, [calls, networkFlags, networkStatuses, receivedFaxes.length, registrationResults, sentFaxJobs, sessions]);

  const initializedRef = useRef(false);
  const previousRef = useRef<TriggerSnapshot | null>(null);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousRef.current = snapshot;
      return;
    }

    const previous = previousRef.current;
    previousRef.current = snapshot;
    if (!previous || homeMode === "dashboard") return;

    let shouldSwitch = false;

    // Packet capture major ops: only transition when a session becomes running.
    if ([...snapshot.runningSessionIds].some((id) => !previous.runningSessionIds.has(id))) {
      shouldSwitch = true;
    }

    // Soft phone major ops: call starts/activates.
    if (!shouldSwitch) {
      for (const [id, state] of snapshot.callStates.entries()) {
        const prevState = previous.callStates.get(id);
        if (!prevState && isActiveCallState(state)) {
          shouldSwitch = true;
          break;
        }
        if (!isActiveCallState(prevState) && isActiveCallState(state)) {
          shouldSwitch = true;
          break;
        }
      }
    }

    // Fax major ops: send pipeline enters pending/sending or new received fax arrives.
    if (!shouldSwitch) {
      if (snapshot.receivedFaxCount > previous.receivedFaxCount) {
        shouldSwitch = true;
      } else {
        for (const [id, status] of snapshot.sentFaxStates.entries()) {
          const prevStatus = previous.sentFaxStates.get(id);
          const nowActive = status === "pending" || status === "sending";
          const wasActive = prevStatus === "pending" || prevStatus === "sending";
          if ((!prevStatus && nowActive) || (!wasActive && nowActive)) {
            shouldSwitch = true;
            break;
          }
        }
      }
    }

    // Registration major ops: fresh registration result timestamp.
    if (!shouldSwitch && snapshot.latestRegistrationResultAt > previous.latestRegistrationResultAt) {
      shouldSwitch = true;
    }

    // Network major ops: at least one test transitions into running.
    if (!shouldSwitch) {
      const prevRunning = countRunningNetworkTests(previous.networkStatuses, previous.networkFlags);
      const nowRunning = countRunningNetworkTests(snapshot.networkStatuses, snapshot.networkFlags);
      if (prevRunning === 0 && nowRunning > 0) {
        shouldSwitch = true;
      } else {
        for (const [key, status] of Object.entries(snapshot.networkStatuses)) {
          const prevStatus = previous.networkStatuses[key];
          if (prevStatus === "idle" && status === "running") {
            shouldSwitch = true;
            break;
          }
        }
      }
    }

    if (shouldSwitch) showDashboard();
  }, [homeMode, showDashboard, snapshot]);
}

