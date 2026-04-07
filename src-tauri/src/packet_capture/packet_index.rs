//! SQLite-based packet index with FTS5 full-text search.
//!
//! Provides O(log n) lookups for packet metadata and full-text search
//! capabilities for SIP content (Call-ID, URIs, methods).
//!
//! This replaces O(n) memory scans with indexed database queries,
//! enabling efficient filtering and searching over millions of packets.

use std::path::Path;

use anyhow::{Context, Result};
use parking_lot::RwLock;
use rusqlite::{params, Connection};

use crate::packet_capture::{PacketInfo, Protocol};

/// Indexed packet metadata for fast lookups.
#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexedPacket {
    pub id: i64,
    pub timestamp: i64,
    pub src_ip: String,
    pub dst_ip: String,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: String,
    pub size: usize,
    pub buffer_offset: i64,
}

/// SIP content for full-text search.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SipIndexEntry {
    pub packet_id: i64,
    pub call_id: Option<String>,
    pub from_uri: Option<String>,
    pub to_uri: Option<String>,
    pub method: Option<String>,
}

/// Query parameters for packet searches.
#[derive(Debug, Clone, Default)]
pub struct PacketQuery {
    /// Filter by source IP (exact match).
    pub src_ip: Option<String>,
    /// Filter by destination IP (exact match).
    pub dst_ip: Option<String>,
    /// Filter by source port.
    pub src_port: Option<u16>,
    /// Filter by destination port.
    pub dst_port: Option<u16>,
    /// Filter by protocol.
    pub protocol: Option<String>,
    /// Filter by timestamp range (start, inclusive).
    pub timestamp_start: Option<i64>,
    /// Filter by timestamp range (end, inclusive).
    pub timestamp_end: Option<i64>,
    /// Full-text search query for SIP content.
    pub fts_query: Option<String>,
    /// Maximum results to return.
    pub limit: Option<usize>,
    /// Offset for pagination.
    pub offset: Option<usize>,
}

/// Packet index with SQLite backend.
pub struct PacketIndex {
    conn: RwLock<Connection>,
    next_offset: std::sync::atomic::AtomicI64,
}

impl PacketIndex {
    /// Create a new in-memory packet index.
    pub fn new_in_memory() -> Result<Self> {
        let conn =
            Connection::open_in_memory().context("Failed to create in-memory SQLite database")?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: RwLock::new(conn),
            next_offset: std::sync::atomic::AtomicI64::new(0),
        })
    }

    /// Create a packet index backed by a file.
    pub fn new_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path).context("Failed to open SQLite database")?;
        Self::init_schema(&conn)?;

        // Get the max offset from existing data
        let max_offset: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(buffer_offset), -1) FROM packet_index",
                [],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        Ok(Self {
            conn: RwLock::new(conn),
            next_offset: std::sync::atomic::AtomicI64::new(max_offset + 1),
        })
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            -- Main packet index table
            CREATE TABLE IF NOT EXISTS packet_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                src_ip TEXT NOT NULL,
                dst_ip TEXT NOT NULL,
                src_port INTEGER NOT NULL,
                dst_port INTEGER NOT NULL,
                protocol TEXT NOT NULL,
                size INTEGER NOT NULL,
                buffer_offset INTEGER NOT NULL
            );
            
            -- Create indexes for fast lookups
            CREATE INDEX IF NOT EXISTS idx_timestamp ON packet_index(timestamp);
            CREATE INDEX IF NOT EXISTS idx_src_ip ON packet_index(src_ip);
            CREATE INDEX IF NOT EXISTS idx_dst_ip ON packet_index(dst_ip);
            CREATE INDEX IF NOT EXISTS idx_src_port ON packet_index(src_port);
            CREATE INDEX IF NOT EXISTS idx_dst_port ON packet_index(dst_port);
            CREATE INDEX IF NOT EXISTS idx_protocol ON packet_index(protocol);
            CREATE INDEX IF NOT EXISTS idx_buffer_offset ON packet_index(buffer_offset);
            
            -- FTS5 virtual table for SIP content full-text search
            CREATE VIRTUAL TABLE IF NOT EXISTS sip_content USING fts5(
                packet_id,
                call_id,
                from_uri,
                to_uri,
                method,
                content
            );
            
            -- Performance settings
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;  -- 64MB cache
            PRAGMA temp_store = MEMORY;
            "#,
        )
        .context("Failed to initialize packet index schema")?;

        Ok(())
    }

    /// Index a packet and return its assigned buffer offset.
    pub fn index_packet(&self, packet: &PacketInfo, buffer_offset: Option<i64>) -> Result<i64> {
        let offset = buffer_offset.unwrap_or_else(|| {
            self.next_offset
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        });

        let timestamp = packet.timestamp.timestamp_millis();
        let protocol_str = format!("{:?}", packet.protocol);

        let conn = self.conn.write();
        conn.execute(
            "INSERT INTO packet_index (timestamp, src_ip, dst_ip, src_port, dst_port, protocol, size, buffer_offset)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                timestamp,
                packet.src_ip.to_string(),
                packet.dst_ip.to_string(),
                packet.src_port as i32,
                packet.dst_port as i32,
                protocol_str,
                packet.size as i64,
                offset,
            ],
        )
        .context("Failed to index packet")?;

        let packet_id = conn.last_insert_rowid();

        // Index SIP content for full-text search
        if matches!(packet.protocol, Protocol::SIP) {
            if let Some(ref decoded) = packet.decoded {
                if let crate::packet_capture::ApplicationLayer::Sip(ref sip) = decoded.application {
                    let content = String::from_utf8_lossy(&packet.data);
                    conn.execute(
                            "INSERT INTO sip_content (packet_id, call_id, from_uri, to_uri, method, content)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            params![
                                packet_id.to_string(),
                                sip.call_id.as_deref(),
                                sip.from.as_deref(),
                                sip.to.as_deref(),
                                sip.method.as_deref(),
                                content.as_ref(),
                            ],
                        )
                        .context("Failed to index SIP content")?;
                }
            }
        }

        Ok(offset)
    }

    /// Index multiple packets in a batch (more efficient).
    pub fn index_packets_batch(&self, packets: &[(PacketInfo, Option<i64>)]) -> Result<Vec<i64>> {
        let conn = self.conn.write();
        let tx = conn.unchecked_transaction()?;

        let mut offsets = Vec::with_capacity(packets.len());

        for (packet, buffer_offset) in packets {
            let offset = buffer_offset.unwrap_or_else(|| {
                self.next_offset
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            });
            offsets.push(offset);

            let timestamp = packet.timestamp.timestamp_millis();
            let protocol_str = format!("{:?}", packet.protocol);

            tx.execute(
                "INSERT INTO packet_index (timestamp, src_ip, dst_ip, src_port, dst_port, protocol, size, buffer_offset)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    timestamp,
                    packet.src_ip.to_string(),
                    packet.dst_ip.to_string(),
                    packet.src_port as i32,
                    packet.dst_port as i32,
                    protocol_str,
                    packet.size as i64,
                    offset,
                ],
            )?;

            let packet_id = tx.last_insert_rowid();

            // Index SIP content
            if matches!(packet.protocol, Protocol::SIP) {
                if let Some(ref decoded) = packet.decoded {
                    if let crate::packet_capture::ApplicationLayer::Sip(ref sip) =
                        decoded.application
                    {
                        let content = String::from_utf8_lossy(&packet.data);
                        tx.execute(
                            "INSERT INTO sip_content (packet_id, call_id, from_uri, to_uri, method, content)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            params![
                                packet_id.to_string(),
                                sip.call_id.as_deref(),
                                sip.from.as_deref(),
                                sip.to.as_deref(),
                                sip.method.as_deref(),
                                content.as_ref(),
                            ],
                        )?;
                    }
                }
            }
        }

        tx.commit()?;
        Ok(offsets)
    }

    /// Query packets based on filters.
    pub fn query(&self, query: &PacketQuery) -> Result<Vec<IndexedPacket>> {
        let conn = self.conn.read();

        // Build dynamic query
        let mut sql = String::from("SELECT id, timestamp, src_ip, dst_ip, src_port, dst_port, protocol, size, buffer_offset FROM packet_index WHERE 1=1");
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref src_ip) = query.src_ip {
            sql.push_str(" AND src_ip = ?");
            params.push(Box::new(src_ip.clone()));
        }
        if let Some(ref dst_ip) = query.dst_ip {
            sql.push_str(" AND dst_ip = ?");
            params.push(Box::new(dst_ip.clone()));
        }
        if let Some(src_port) = query.src_port {
            sql.push_str(" AND src_port = ?");
            params.push(Box::new(src_port as i32));
        }
        if let Some(dst_port) = query.dst_port {
            sql.push_str(" AND dst_port = ?");
            params.push(Box::new(dst_port as i32));
        }
        if let Some(ref protocol) = query.protocol {
            sql.push_str(" AND protocol = ?");
            params.push(Box::new(protocol.clone()));
        }
        if let Some(start) = query.timestamp_start {
            sql.push_str(" AND timestamp >= ?");
            params.push(Box::new(start));
        }
        if let Some(end) = query.timestamp_end {
            sql.push_str(" AND timestamp <= ?");
            params.push(Box::new(end));
        }

        // Handle FTS query (join with sip_content)
        if let Some(ref fts) = query.fts_query {
            sql = format!(
                "SELECT p.id, p.timestamp, p.src_ip, p.dst_ip, p.src_port, p.dst_port, p.protocol, p.size, p.buffer_offset 
                 FROM packet_index p
                 INNER JOIN sip_content s ON p.id = CAST(s.packet_id AS INTEGER)
                 WHERE s.sip_content MATCH ? {}",
                if query.src_ip.is_some() || query.dst_ip.is_some() || query.protocol.is_some() {
                    " AND p.id IN (SELECT id FROM packet_index WHERE 1=1".to_string() + 
                    if query.src_ip.is_some() { " AND src_ip = ?" } else { "" } +
                    if query.dst_ip.is_some() { " AND dst_ip = ?" } else { "" } +
                    if query.protocol.is_some() { " AND protocol = ?" } else { "" } +
                    ")"
                } else {
                    String::new()
                }
            );
            params.insert(0, Box::new(fts.clone()));
        }

        sql.push_str(" ORDER BY timestamp DESC");

        if let Some(limit) = query.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }
        if let Some(offset) = query.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(IndexedPacket {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                src_ip: row.get(2)?,
                dst_ip: row.get(3)?,
                src_port: row.get::<_, i32>(4)? as u16,
                dst_port: row.get::<_, i32>(5)? as u16,
                protocol: row.get(6)?,
                size: row.get::<_, i64>(7)? as usize,
                buffer_offset: row.get(8)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }

    /// Full-text search for SIP content.
    pub fn search_sip(&self, query: &str, limit: usize) -> Result<Vec<SipIndexEntry>> {
        let conn = self.conn.read();

        let mut stmt = conn.prepare(
            "SELECT packet_id, call_id, from_uri, to_uri, method 
             FROM sip_content 
             WHERE sip_content MATCH ?1
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![query, limit as i64], |row| {
            Ok(SipIndexEntry {
                packet_id: row.get::<_, String>(0)?.parse().unwrap_or(0),
                call_id: row.get(1).ok(),
                from_uri: row.get(2).ok(),
                to_uri: row.get(3).ok(),
                method: row.get(4).ok(),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }

    /// Get total packet count.
    pub fn count(&self) -> Result<usize> {
        let conn = self.conn.read();
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM packet_index", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Get packet count matching a query.
    pub fn count_query(&self, query: &PacketQuery) -> Result<usize> {
        let conn = self.conn.read();

        let mut sql = String::from("SELECT COUNT(*) FROM packet_index WHERE 1=1");
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref src_ip) = query.src_ip {
            sql.push_str(" AND src_ip = ?");
            params.push(Box::new(src_ip.clone()));
        }
        if let Some(ref dst_ip) = query.dst_ip {
            sql.push_str(" AND dst_ip = ?");
            params.push(Box::new(dst_ip.clone()));
        }
        if let Some(ref protocol) = query.protocol {
            sql.push_str(" AND protocol = ?");
            params.push(Box::new(protocol.clone()));
        }
        if let Some(start) = query.timestamp_start {
            sql.push_str(" AND timestamp >= ?");
            params.push(Box::new(start));
        }
        if let Some(end) = query.timestamp_end {
            sql.push_str(" AND timestamp <= ?");
            params.push(Box::new(end));
        }

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let count: i64 = stmt.query_row(param_refs.as_slice(), |row| row.get(0))?;

        Ok(count as usize)
    }

    /// Clear all indexed packets.
    pub fn clear(&self) -> Result<()> {
        let conn = self.conn.write();
        conn.execute_batch("DELETE FROM sip_content; DELETE FROM packet_index; VACUUM;")?;
        self.next_offset
            .store(0, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    /// Get buffer offsets for packets matching a query.
    pub fn get_offsets(&self, query: &PacketQuery) -> Result<Vec<i64>> {
        let packets = self.query(query)?;
        Ok(packets.into_iter().map(|p| p.buffer_offset).collect())
    }

    /// Get distinct protocols in the index.
    pub fn get_protocols(&self) -> Result<Vec<String>> {
        let conn = self.conn.read();
        let mut stmt =
            conn.prepare("SELECT DISTINCT protocol FROM packet_index ORDER BY protocol")?;
        let rows = stmt.query_map([], |row| row.get(0))?;

        let mut protocols = Vec::new();
        for row in rows {
            protocols.push(row?);
        }
        Ok(protocols)
    }

    /// Get distinct IPs in the index.
    pub fn get_unique_ips(&self) -> Result<(Vec<String>, Vec<String>)> {
        let conn = self.conn.read();

        let mut src_stmt =
            conn.prepare("SELECT DISTINCT src_ip FROM packet_index ORDER BY src_ip")?;
        let src_rows = src_stmt.query_map([], |row| row.get(0))?;
        let mut src_ips = Vec::new();
        for row in src_rows {
            src_ips.push(row?);
        }

        let mut dst_stmt =
            conn.prepare("SELECT DISTINCT dst_ip FROM packet_index ORDER BY dst_ip")?;
        let dst_rows = dst_stmt.query_map([], |row| row.get(0))?;
        let mut dst_ips = Vec::new();
        for row in dst_rows {
            dst_ips.push(row?);
        }

        Ok((src_ips, dst_ips))
    }
}

// Thread safety
unsafe impl Send for PacketIndex {}
unsafe impl Sync for PacketIndex {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn create_test_packet(protocol: Protocol, src_port: u16, dst_port: u16) -> PacketInfo {
        PacketInfo {
            timestamp: chrono::Utc::now(),
            src_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)),
            dst_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
            src_port,
            dst_port,
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
    fn test_index_creation() {
        let index = PacketIndex::new_in_memory().unwrap();
        assert_eq!(index.count().unwrap(), 0);
    }

    #[test]
    fn test_index_packet() {
        let index = PacketIndex::new_in_memory().unwrap();
        let packet = create_test_packet(Protocol::SIP, 5060, 5060);

        let offset = index.index_packet(&packet, None).unwrap();
        assert_eq!(offset, 0);
        assert_eq!(index.count().unwrap(), 1);
    }

    #[test]
    fn test_query_by_protocol() {
        let index = PacketIndex::new_in_memory().unwrap();

        index
            .index_packet(&create_test_packet(Protocol::SIP, 5060, 5060), None)
            .unwrap();
        index
            .index_packet(&create_test_packet(Protocol::RTP, 10000, 10001), None)
            .unwrap();
        index
            .index_packet(&create_test_packet(Protocol::SIP, 5060, 5060), None)
            .unwrap();

        let query = PacketQuery {
            protocol: Some("SIP".to_string()),
            ..Default::default()
        };

        let results = index.query(&query).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_batch_indexing() {
        let index = PacketIndex::new_in_memory().unwrap();

        let packets: Vec<(PacketInfo, Option<i64>)> = (0..1000)
            .map(|i| (create_test_packet(Protocol::RTP, 10000 + i, 10001), None))
            .collect();

        let offsets = index.index_packets_batch(&packets).unwrap();
        assert_eq!(offsets.len(), 1000);
        assert_eq!(index.count().unwrap(), 1000);
    }

    #[test]
    fn test_pagination() {
        let index = PacketIndex::new_in_memory().unwrap();

        for i in 0..100 {
            index
                .index_packet(&create_test_packet(Protocol::UDP, 5000 + i, 5001), None)
                .unwrap();
        }

        let query = PacketQuery {
            limit: Some(10),
            offset: Some(20),
            ..Default::default()
        };

        let results = index.query(&query).unwrap();
        assert_eq!(results.len(), 10);
    }
}
