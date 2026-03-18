use serde::{Deserialize, Serialize};

/// Raw packet data broadcast from the listener to subscribers (e.g. audio receiver).
#[derive(Debug, Clone)]
pub struct PacketData {
    pub data: Vec<u8>,
    pub source_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MulticastGroup {
    pub group: String,
    pub interface: Option<String>,
    pub port: u16,
    pub joined_at: String,
    pub packets_received: u64,
    pub bytes_received: u64,
    pub sources_seen: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinResult {
    pub success: bool,
    pub group: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaveResult {
    pub success: bool,
    pub group: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendTestResult {
    pub success: bool,
    pub group: String,
    pub sent: u32,
    pub elapsed_ms: f64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgmpQueryResult {
    pub groups_found: Vec<MulticastGroupReport>,
    pub igmp_version: u8,
    pub query_time_ms: f64,
    pub responders: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MulticastGroupReport {
    pub group: String,
    pub last_reporter: String,
    pub igmp_version: u8,
    pub compatibility_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnoopingVerifyResult {
    pub group: String,
    pub snooping_active: bool,
    pub join_latency_ms: f64,
    pub leave_verified: bool,
    pub ttl_check: bool,
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MulticastPacketEvent {
    pub group: String,
    pub source_ip: String,
    pub size: u32,
    pub timestamp: String,
    pub ttl: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenerStats {
    pub group: String,
    pub packets_per_sec: f64,
    pub bytes_per_sec: f64,
    pub unique_sources: u32,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStreamState {
    pub group: String,
    pub playing: bool,
    pub muted: bool,
    pub volume: f32,
    pub codec_name: String,
    pub sample_rate: u32,
    pub ssrc: u32,
    pub source_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStreamMetrics {
    pub group: String,
    pub jitter_ms: f64,
    pub loss_percent: f64,
    pub bitrate_kbps: f64,
    pub recv_peak: f64,
    pub packets_received: u64,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioWaveform {
    pub samples: Vec<f32>,
    pub peak: f32,
    pub rms: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioGeneratorState {
    pub group: String,
    pub generating: bool,
    pub tone_type: String,
    pub frequency: f32,
    pub amplitude: f32,
    pub source_mode: String,
    pub input_device_id: Option<String>,
    pub input_gain: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioGeneratorMetrics {
    pub group: String,
    pub packets_sent: u64,
    pub bytes_sent: u64,
    pub duration_secs: f64,
    pub bitrate_kbps: f64,
}
