/**
 * Multicast / IGMP Tester API — typed wrappers for multicast backend commands.
 */

import { invokeTauri } from "./invoke";
import type {
  JoinResult,
  LeaveResult,
  MulticastGroup,
  SendTestResult,
  IgmpQueryResult,
  SnoopingVerifyResult,
  AudioWaveform,
  AudioStreamMetrics,
  AudioGeneratorState,
  AudioGeneratorMetrics,
} from "@/types/multicast";

// ── Join / Leave / List ─────────────────────────────────────────

export async function multicastJoinGroup(
  group: string,
  port: number,
  iface?: string,
): Promise<JoinResult> {
  return invokeTauri<JoinResult>("multicast_join_group", {
    group,
    port,
    interface: iface ?? null,
  });
}

export async function multicastLeaveGroup(group: string, port?: number): Promise<LeaveResult> {
  if (typeof port === "number") {
    return invokeTauri<LeaveResult>("multicast_leave_group_exact", { group, port });
  }
  return invokeTauri<LeaveResult>("multicast_leave_group", { group });
}

export async function multicastListGroups(): Promise<MulticastGroup[]> {
  return invokeTauri<MulticastGroup[]>("multicast_list_groups");
}

// ── Send Test ───────────────────────────────────────────────────

export async function multicastSendTest(
  group: string,
  port: number,
  count: number,
  intervalMs: number,
  ttl?: number,
): Promise<SendTestResult> {
  return invokeTauri<SendTestResult>("multicast_send_test", {
    group,
    port,
    count,
    interval_ms: intervalMs,
    ttl: ttl ?? null,
  });
}

// ── IGMP Query / Snooping ───────────────────────────────────────

export async function multicastIgmpQuery(
  iface?: string,
): Promise<IgmpQueryResult> {
  return invokeTauri<IgmpQueryResult>("multicast_igmp_query", {
    interface: iface ?? null,
  });
}

export async function multicastSnoopingVerify(
  group: string,
  iface?: string,
): Promise<SnoopingVerifyResult> {
  return invokeTauri<SnoopingVerifyResult>("multicast_snooping_verify", {
    group,
    interface: iface ?? null,
  });
}

// ── Listener ────────────────────────────────────────────────────

export async function multicastStopListener(
  group: string,
  port: number,
): Promise<void> {
  return invokeTauri<void>("multicast_stop_listener", { group, port });
}

// ── Audio Stream ────────────────────────────────────────────────

export async function multicastAudioStart(
  group: string,
  port: number,
  outputDeviceId?: string,
  codec?: string,
): Promise<void> {
  return invokeTauri<void>("multicast_audio_start", {
    group,
    port,
    output_device_id: outputDeviceId ?? null,
    codec: codec ?? null,
  });
}

export async function multicastAudioStop(group: string): Promise<void> {
  return invokeTauri<void>("multicast_audio_stop", { group });
}

export async function multicastAudioSetVolume(
  group: string,
  volume: number,
): Promise<void> {
  return invokeTauri<void>("multicast_audio_set_volume", { group, volume });
}

export async function multicastAudioSetMuted(
  group: string,
  muted: boolean,
): Promise<void> {
  return invokeTauri<void>("multicast_audio_set_muted", { group, muted });
}

export async function multicastAudioGetWaveform(
  group: string,
): Promise<AudioWaveform> {
  return invokeTauri<AudioWaveform>("multicast_audio_get_waveform", { group });
}

export async function multicastAudioGetMetrics(
  group: string,
): Promise<AudioStreamMetrics> {
  return invokeTauri<AudioStreamMetrics>("multicast_audio_get_metrics", {
    group,
  });
}

// ── Audio Generator ──────────────────────────────────────────────

export async function multicastGenerateStart(
  group: string,
  port: number,
  codec?: string,
  source?: string,
  tone?: string,
  frequency?: number,
  amplitude?: number,
  inputDeviceId?: string,
): Promise<void> {
  return invokeTauri<void>("multicast_generate_start", {
    group,
    port,
    codec: codec ?? null,
    source: source ?? null,
    tone: tone ?? null,
    frequency: frequency ?? null,
    amplitude: amplitude ?? null,
    input_device_id: inputDeviceId ?? null,
  });
}

export async function multicastGenerateStop(group: string): Promise<void> {
  return invokeTauri<void>("multicast_generate_stop", { group });
}

export async function multicastGenerateSetTone(
  group: string,
  tone: string,
  frequency?: number,
  amplitude?: number,
): Promise<void> {
  return invokeTauri<void>("multicast_generate_set_tone", {
    group,
    tone,
    frequency: frequency ?? null,
    amplitude: amplitude ?? null,
  });
}

export async function multicastGenerateGetState(
  group: string,
): Promise<AudioGeneratorState> {
  return invokeTauri<AudioGeneratorState>("multicast_generate_get_state", {
    group,
  });
}

export async function multicastGenerateGetMetrics(
  group: string,
): Promise<AudioGeneratorMetrics> {
  return invokeTauri<AudioGeneratorMetrics>("multicast_generate_get_metrics", {
    group,
  });
}

export async function multicastGenerateList(): Promise<AudioGeneratorState[]> {
  return invokeTauri<AudioGeneratorState[]>("multicast_generate_list");
}

export async function multicastGenerateSetSource(
  group: string,
  source: string,
  deviceId?: string,
): Promise<void> {
  return invokeTauri<void>("multicast_generate_set_source", {
    group,
    source,
    device_id: deviceId ?? null,
  });
}

export async function multicastGenerateFeedTts(
  group: string,
  samples: number[],
): Promise<void> {
  return invokeTauri<void>("multicast_generate_feed_tts", { group, samples });
}

export async function multicastGenerateSetInputGain(
  group: string,
  gain: number,
): Promise<void> {
  return invokeTauri<void>("multicast_generate_set_input_gain", { group, gain });
}
