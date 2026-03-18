use std::collections::HashMap;
use std::net::IpAddr;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatistics {
    pub total_packets: u64,
    pub total_bytes: u64,
    pub packets_by_protocol: HashMap<String, u64>,
    pub bytes_by_protocol: HashMap<String, u64>,
    pub top_src_ips: Vec<(String, u64)>,
    pub top_dst_ips: Vec<(String, u64)>,
    pub packets_per_second: f64,
    pub bytes_per_second: f64,
    pub start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub last_packet_time: Option<chrono::DateTime<chrono::Utc>>,
    /// Best-effort libpcap counters (None when stats are unsupported/unavailable).
    pub pcap_received: Option<u64>,
    pub pcap_dropped: Option<u64>,
    pub pcap_if_dropped: Option<u64>,
    pub last_stats_timestamp_ms: Option<i64>,
}

impl CaptureStatistics {
    pub fn new() -> Self {
        Self {
            total_packets: 0,
            total_bytes: 0,
            packets_by_protocol: HashMap::new(),
            bytes_by_protocol: HashMap::new(),
            top_src_ips: Vec::new(),
            top_dst_ips: Vec::new(),
            packets_per_second: 0.0,
            bytes_per_second: 0.0,
            start_time: Some(chrono::Utc::now()),
            last_packet_time: None,
            pcap_received: None,
            pcap_dropped: None,
            pcap_if_dropped: None,
            last_stats_timestamp_ms: None,
        }
    }

    pub fn add_packet(&mut self, packet: &crate::packet_capture::PacketInfo) {
        self.total_packets += 1;
        self.total_bytes += packet.size as u64;
        self.last_packet_time = Some(packet.timestamp);

        // Protocol statistics
        let protocol_str = match packet.protocol {
            crate::packet_capture::Protocol::SIP => "SIP",
            crate::packet_capture::Protocol::RTP => "RTP",
            crate::packet_capture::Protocol::SRTP => "SRTP",
            crate::packet_capture::Protocol::RTCP => "RTCP",
            crate::packet_capture::Protocol::FAX => "FAX",
            crate::packet_capture::Protocol::TCP => "TCP",
            crate::packet_capture::Protocol::UDP => "UDP",
            crate::packet_capture::Protocol::HTTP => "HTTP",
            crate::packet_capture::Protocol::HTTPS => "HTTPS",
            crate::packet_capture::Protocol::DNS => "DNS",
            crate::packet_capture::Protocol::ICMP => "ICMP",
            crate::packet_capture::Protocol::ARP => "ARP",
            crate::packet_capture::Protocol::Other => "Other",
        };

        *self.packets_by_protocol.entry(protocol_str.to_string()).or_insert(0) += 1;
        *self.bytes_by_protocol.entry(protocol_str.to_string()).or_insert(0) += packet.size as u64;

        // Update rates
        if let Some(start) = self.start_time {
            let duration = packet.timestamp.signed_duration_since(start);
            if duration.num_seconds() > 0 {
                self.packets_per_second = self.total_packets as f64 / duration.num_seconds() as f64;
                self.bytes_per_second = self.total_bytes as f64 / duration.num_seconds() as f64;
            }
        }
    }

    /// Update capture quality counters from `pcap::Capture::stats()` output.
    pub fn update_pcap_stats(
        &mut self,
        received: u32,
        dropped: u32,
        if_dropped: u32,
        observed_at: chrono::DateTime<chrono::Utc>,
    ) {
        self.pcap_received = Some(received as u64);
        self.pcap_dropped = Some(dropped as u64);
        self.pcap_if_dropped = Some(if_dropped as u64);
        self.last_stats_timestamp_ms = Some(observed_at.timestamp_millis());
    }

    #[allow(dead_code)]
    pub fn update_top_ips(&mut self, ip_counts: &HashMap<IpAddr, u64>, is_src: bool) {
        let mut sorted: Vec<_> = ip_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        sorted.truncate(10);

        if is_src {
            self.top_src_ips = sorted.into_iter().map(|(ip, count)| (ip.to_string(), *count)).collect();
        } else {
            self.top_dst_ips = sorted.into_iter().map(|(ip, count)| (ip.to_string(), *count)).collect();
        }
    }
}
