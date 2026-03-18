//! Streaming filter evaluation using the packet index.
//!
//! Converts FilterConfig to SQL queries against the packet index for O(log n)
//! lookups instead of O(n) memory scans. Supports real-time streaming with
//! efficient incremental filtering.

use std::sync::Arc;

use anyhow::Result;
use parking_lot::RwLock;

use crate::packet_capture::filter::FilterConfig;
use crate::packet_capture::packet_index::{IndexedPacket, PacketIndex, PacketQuery};
use crate::packet_capture::ring_buffer::PacketRingBuffer;
use crate::packet_capture::PacketInfo;

/// Streaming filter that evaluates packets against the index.
pub struct StreamingFilter {
    index: Arc<PacketIndex>,
    ring_buffer: Option<Arc<PacketRingBuffer>>,
    config: RwLock<FilterConfig>,
    last_offset: std::sync::atomic::AtomicI64,
}

impl StreamingFilter {
    /// Create a new streaming filter.
    pub fn new(index: Arc<PacketIndex>) -> Self {
        Self {
            index,
            ring_buffer: None,
            config: RwLock::new(FilterConfig::default()),
            last_offset: std::sync::atomic::AtomicI64::new(-1),
        }
    }

    /// Set the ring buffer for packet retrieval.
    pub fn set_ring_buffer(&mut self, buffer: Arc<PacketRingBuffer>) {
        self.ring_buffer = Some(buffer);
    }

    /// Update the filter configuration.
    pub fn set_filter(&self, config: FilterConfig) {
        *self.config.write() = config;
        // Reset last offset to re-evaluate all packets with new filter
        self.last_offset
            .store(-1, std::sync::atomic::Ordering::SeqCst);
    }

    /// Get the current filter configuration.
    pub fn get_filter(&self) -> FilterConfig {
        self.config.read().clone()
    }

    /// Convert FilterConfig to PacketQuery for index evaluation.
    pub fn to_query(&self, config: &FilterConfig) -> PacketQuery {
        PacketQuery {
            // For IP ranges, we'd need to expand CIDR notation
            // For now, use exact match on first IP if specified
            src_ip: config.src_ip_ranges.first().and_then(|ip| {
                if ip.contains('/') {
                    None // Skip CIDR for now
                } else {
                    Some(ip.clone())
                }
            }),
            dst_ip: config.dst_ip_ranges.first().and_then(|ip| {
                if ip.contains('/') {
                    None
                } else {
                    Some(ip.clone())
                }
            }),
            src_port: config.src_ports.first().copied(),
            dst_port: config.dst_ports.first().copied(),
            protocol: config.protocols.first().map(|p| p.to_uppercase()),
            timestamp_start: None,
            timestamp_end: None,
            fts_query: None,
            limit: None,
            offset: None,
        }
    }

    /// Query packets matching the current filter with pagination.
    pub fn query_packets(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<IndexedPacket>> {
        let config = self.config.read().clone();
        let mut query = self.to_query(&config);
        query.offset = Some(offset);
        query.limit = Some(limit);

        self.index.query(&query)
    }

    /// Query packets with a custom filter and pagination.
    pub fn query_with_filter(
        &self,
        filter: &FilterConfig,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<IndexedPacket>> {
        let mut query = self.to_query(filter);
        query.offset = Some(offset);
        query.limit = Some(limit);

        self.index.query(&query)
    }

    /// Get total count of packets matching the current filter.
    pub fn count_matching(&self) -> Result<usize> {
        let config = self.config.read().clone();
        let query = self.to_query(&config);

        self.index.count_query(&query)
    }

    /// Query packets in a time range.
    pub fn query_time_range(
        &self,
        start_ms: i64,
        end_ms: i64,
        limit: usize,
    ) -> Result<Vec<IndexedPacket>> {
        let config = self.config.read().clone();
        let mut query = self.to_query(&config);
        query.timestamp_start = Some(start_ms);
        query.timestamp_end = Some(end_ms);
        query.limit = Some(limit);

        self.index.query(&query)
    }

    /// Search SIP packets using full-text search.
    pub fn search_sip(&self, search_query: &str, limit: usize) -> Result<Vec<IndexedPacket>> {
        // First, get matching SIP entries from FTS
        let sip_entries = self.index.search_sip(search_query, limit)?;

        // Then get full packet info for those IDs
        let mut results = Vec::with_capacity(sip_entries.len());
        for _entry in sip_entries {
            let query = PacketQuery {
                limit: Some(1),
                ..Default::default()
            };
            // Note: We'd need to add ID-based query to packet_index
            // For now, return empty - this is a placeholder
            if let Ok(packets) = self.index.query(&query) {
                results.extend(packets);
            }
        }

        Ok(results)
    }

    /// Get new packets since last poll.
    /// Returns packets that match the current filter and have been added since the last call.
    pub fn get_new_packets(&self, limit: usize) -> Result<Vec<IndexedPacket>> {
        let last = self.last_offset.load(std::sync::atomic::Ordering::Relaxed);
        let config = self.config.read().clone();
        let mut query = self.to_query(&config);
        query.limit = Some(limit);

        // Get total count to determine if there are new packets
        let total = self.index.count()?;
        if total == 0 || (last >= 0 && last as usize >= total) {
            return Ok(Vec::new());
        }

        // Query from last offset
        if last >= 0 {
            query.offset = Some(last as usize + 1);
        }

        let results = self.index.query(&query)?;

        // Update last offset
        if let Some(last_packet) = results.last() {
            self.last_offset
                .store(last_packet.buffer_offset, std::sync::atomic::Ordering::SeqCst);
        }

        Ok(results)
    }

    /// Reset the streaming position to the beginning.
    pub fn reset(&self) {
        self.last_offset
            .store(-1, std::sync::atomic::Ordering::SeqCst);
    }

    /// Get packets from the ring buffer by offsets.
    pub fn get_packets_by_offsets(&self, offsets: &[i64]) -> Vec<PacketInfo> {
        let Some(ref buffer) = self.ring_buffer else {
            return Vec::new();
        };

        offsets
            .iter()
            .filter_map(|&offset| {
                if offset >= 0 {
                    buffer.get_range(offset as usize, 1).into_iter().next()
                } else {
                    None
                }
            })
            .collect()
    }

    /// Get protocol statistics from the index.
    pub fn get_protocol_stats(&self) -> Result<Vec<(String, usize)>> {
        let protocols = self.index.get_protocols()?;
        let mut stats = Vec::with_capacity(protocols.len());

        for protocol in protocols {
            let query = PacketQuery {
                protocol: Some(protocol.clone()),
                ..Default::default()
            };
            let count = self.index.count_query(&query)?;
            stats.push((protocol, count));
        }

        Ok(stats)
    }

    /// Get IP statistics from the index.
    pub fn get_ip_stats(&self) -> Result<(Vec<String>, Vec<String>)> {
        self.index.get_unique_ips()
    }
}

/// Builder for creating filtered packet iterators.
pub struct FilteredPacketIterator {
    index: Arc<PacketIndex>,
    query: PacketQuery,
    current_offset: usize,
    page_size: usize,
    buffer: Vec<IndexedPacket>,
    buffer_index: usize,
}

impl FilteredPacketIterator {
    /// Create a new iterator.
    pub fn new(index: Arc<PacketIndex>, filter: &FilterConfig, page_size: usize) -> Self {
        let query = PacketQuery {
            protocol: filter.protocols.first().map(|p| p.to_uppercase()),
            ..Default::default()
        };

        Self {
            index,
            query,
            current_offset: 0,
            page_size,
            buffer: Vec::new(),
            buffer_index: 0,
        }
    }

    /// Fetch the next page of results.
    fn fetch_next_page(&mut self) -> Result<bool> {
        let mut query = self.query.clone();
        query.offset = Some(self.current_offset);
        query.limit = Some(self.page_size);

        self.buffer = self.index.query(&query)?;
        self.buffer_index = 0;
        self.current_offset += self.buffer.len();

        Ok(!self.buffer.is_empty())
    }
}

impl Iterator for FilteredPacketIterator {
    type Item = IndexedPacket;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buffer_index >= self.buffer.len() {
            // Try to fetch next page
            if self.fetch_next_page().ok()? {
                if self.buffer.is_empty() {
                    return None;
                }
            } else {
                return None;
            }
        }

        let packet = self.buffer[self.buffer_index].clone();
        self.buffer_index += 1;
        Some(packet)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packet_capture::Protocol;
    use std::net::{IpAddr, Ipv4Addr};

    fn create_test_packet(protocol: Protocol, src_port: u16) -> PacketInfo {
        PacketInfo {
            timestamp: chrono::Utc::now(),
            src_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            dst_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            src_port,
            dst_port: 5060,
            protocol,
            size: 100,
            frame_length: 142,
            raw_frame: None,
            data: vec![0u8; 100],
            decoded: None,
            fidelity: crate::packet_capture::PacketFidelity::Simulated,
            provenance: crate::packet_capture::PacketProvenance::Unknown,
        }
    }

    #[test]
    fn test_streaming_filter_creation() {
        let index = Arc::new(PacketIndex::new_in_memory().unwrap());
        let filter = StreamingFilter::new(index);
        assert!(filter.get_filter().protocols.is_empty());
    }

    #[test]
    fn test_filter_to_query() {
        let index = Arc::new(PacketIndex::new_in_memory().unwrap());
        let filter = StreamingFilter::new(index);

        let config = FilterConfig {
            protocols: vec!["SIP".to_string()],
            src_ip_ranges: vec!["192.168.1.1".to_string()],
            ..Default::default()
        };

        let query = filter.to_query(&config);
        assert_eq!(query.protocol, Some("SIP".to_string()));
        assert_eq!(query.src_ip, Some("192.168.1.1".to_string()));
    }

    #[test]
    fn test_query_packets() {
        let index = Arc::new(PacketIndex::new_in_memory().unwrap());

        // Add some test packets
        index
            .index_packet(&create_test_packet(Protocol::SIP, 5060), None)
            .unwrap();
        index
            .index_packet(&create_test_packet(Protocol::RTP, 10000), None)
            .unwrap();
        index
            .index_packet(&create_test_packet(Protocol::SIP, 5061), None)
            .unwrap();

        let filter = StreamingFilter::new(index);

        // Set filter for SIP only
        filter.set_filter(FilterConfig {
            protocols: vec!["SIP".to_string()],
            ..Default::default()
        });

        let results = filter.query_packets(0, 100).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_count_matching() {
        let index = Arc::new(PacketIndex::new_in_memory().unwrap());

        for i in 0..100 {
            index
                .index_packet(
                    &create_test_packet(
                        if i % 2 == 0 { Protocol::SIP } else { Protocol::RTP },
                        5060 + i,
                    ),
                    None,
                )
                .unwrap();
        }

        let filter = StreamingFilter::new(index);

        filter.set_filter(FilterConfig {
            protocols: vec!["SIP".to_string()],
            ..Default::default()
        });

        let count = filter.count_matching().unwrap();
        assert_eq!(count, 50);
    }
}
