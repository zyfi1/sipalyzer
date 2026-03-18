export interface MulticastGroup {
  group: string;
  interface?: string;
  port: number;
  joined_at: string;
  packets_received: number;
  bytes_received: number;
  sources_seen: string[];
}

export interface JoinResult {
  success: boolean;
  group: string;
  error?: string;
}

export interface LeaveResult {
  success: boolean;
  group: string;
  error?: string;
}

export interface SendTestResult {
  success: boolean;
  group: string;
  sent: number;
  elapsed_ms: number;
  error?: string;
}

export interface IgmpQueryResult {
  groups_found: MulticastGroupReport[];
  igmp_version: number;
  query_time_ms: number;
  responders: number;
}

export interface MulticastGroupReport {
  group: string;
  last_reporter: string;
  igmp_version: number;
  compatibility_mode: string;
}

export interface SnoopingVerifyResult {
  group: string;
  snooping_active: boolean;
  join_latency_ms: number;
  leave_verified: boolean;
  ttl_check: boolean;
  details: string[];
}

export interface MulticastPacketEvent {
  group: string;
  source_ip: string;
  size: number;
  timestamp: string;
  ttl: number;
}

export interface ListenerStats {
  group: string;
  packets_per_sec: number;
  bytes_per_sec: number;
  unique_sources: number;
  duration_secs: number;
}

export interface AudioStreamState {
  group: string;
  playing: boolean;
  muted: boolean;
  volume: number;
  codec_name: string;
  sample_rate: number;
  ssrc: number;
  source_ip: string;
}

export interface AudioStreamMetrics {
  group: string;
  jitter_ms: number;
  loss_percent: number;
  bitrate_kbps: number;
  recv_peak: number;
  packets_received: number;
  duration_secs: number;
}

export interface AudioWaveform {
  samples: number[];
  peak: number;
  rms: number;
}

export interface AudioGeneratorState {
  group: string;
  generating: boolean;
  tone_type: string;
  frequency: number;
  amplitude: number;
  source_mode: "tone" | "microphone" | "tts";
  input_device_id: string | null;
  input_gain: number;
}

export interface AudioGeneratorMetrics {
  group: string;
  packets_sent: number;
  bytes_sent: number;
  duration_secs: number;
  bitrate_kbps: number;
}
