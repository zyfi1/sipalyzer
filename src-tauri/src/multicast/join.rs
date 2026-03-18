//! Multicast group join/leave management using socket2 (IP_ADD_MEMBERSHIP / IP_DROP_MEMBERSHIP).

use chrono::Utc;
use once_cell::sync::Lazy;
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::SocketAddrV4;
use std::sync::Mutex;
use std::time::Instant;

use super::types::PacketData;

const BROADCAST_CAPACITY: usize = 2048;

/// Per-group stats updated by the listener.
#[derive(Debug, Default, Clone)]
pub struct GroupStats {
    pub packets_received: u64,
    pub bytes_received: u64,
    pub sources_seen: Vec<String>,
}

/// Active multicast membership: socket, metadata, broadcast channel, and stats.
pub struct JoinedGroup {
    pub socket: socket2::Socket,
    pub group: String,
    pub interface: Option<String>,
    pub port: u16,
    pub joined_at: chrono::DateTime<Utc>,
    pub cancel_tx: tokio::sync::watch::Sender<bool>,
    pub packet_tx: tokio::sync::broadcast::Sender<PacketData>,
    pub stats: std::sync::Arc<Mutex<GroupStats>>,
}

pub static ACTIVE_GROUPS: Lazy<Mutex<HashMap<String, JoinedGroup>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn group_key(group: &str, port: u16) -> String {
    format!("{}:{}", group, port)
}

fn resolve_interface_addr(interface: Option<&str>) -> std::net::Ipv4Addr {
    let raw = match interface {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return std::net::Ipv4Addr::UNSPECIFIED,
    };

    if let Ok(ip) = raw.parse::<std::net::Ipv4Addr>() {
        return ip;
    }

    for iface in default_net::get_interfaces() {
        if iface.name == raw {
            if let Some(ipv4) = iface.ipv4.first() {
                return ipv4.addr;
            }
        }
    }

    std::net::Ipv4Addr::UNSPECIFIED
}

/// Updates packet/byte counts and sources for an active group (called from listener).
pub fn update_group_stats(key: &str, packets: u64, bytes: u64, sources: &[String]) {
    let guard = match ACTIVE_GROUPS.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(jg) = guard.get(key) {
        if let Ok(mut st) = jg.stats.lock() {
            st.packets_received = packets;
            st.bytes_received = bytes;
            st.sources_seen = sources.to_vec();
        }
    }
}

/// Joins a multicast group; inserts into ACTIVE_GROUPS and returns JoinResult.
pub async fn join_group(
    group: &str,
    port: u16,
    interface: Option<&str>,
) -> Result<super::types::JoinResult, String> {
    let _span = tracing::info_span!("multicast.group_join", group = %group, port = port).entered();
    tracing::info!(group = %group, port = port, interface = ?interface, "Joining multicast group");
    let group_addr: std::net::Ipv4Addr = group
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if !group_addr.is_multicast() {
        return Err(format!("{} is not a multicast IPv4 address", group));
    }

    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| e.to_string())?;

    socket.set_reuse_address(true).map_err(|e| e.to_string())?;

    // Bind to port 0 — this socket only holds group membership, the listener binds the real port
    let bind_addr = SocketAddrV4::new(std::net::Ipv4Addr::UNSPECIFIED, 0);
    socket
        .bind(&socket2::SockAddr::from(bind_addr))
        .map_err(|e| e.to_string())?;

    let interface_addr = resolve_interface_addr(interface);

    let sock_ref = socket2::SockRef::from(&socket);
    sock_ref
        .join_multicast_v4(&group_addr, &interface_addr)
        .map_err(|e| e.to_string())?;
    sock_ref
        .set_multicast_loop_v4(true)
        .map_err(|e| e.to_string())?;

    tracing::info!("Joined group {}:{} on interface {:?}", group, port, interface);

    let (cancel_tx, _cancel_rx) = tokio::sync::watch::channel(false);
    let (packet_tx, _packet_rx) = tokio::sync::broadcast::channel(BROADCAST_CAPACITY);
    let joined_at = Utc::now();
    let stats = std::sync::Arc::new(Mutex::new(GroupStats::default()));

    let key = group_key(group, port);
    let jg = JoinedGroup {
        socket,
        group: group.to_string(),
        interface: interface.map(String::from),
        port,
        joined_at,
        cancel_tx: cancel_tx.clone(),
        packet_tx,
        stats: stats.clone(),
    };

    {
        let mut guard = ACTIVE_GROUPS
            .lock()
            .map_err(|e| format!("lock: {}", e))?;
        if let Some(existing) = guard.values().find(|g| g.group == group) {
            return Ok(super::types::JoinResult {
                success: false,
                group: group.to_string(),
                error: Some(format!(
                    "group already joined on port {} — leave it before joining another port",
                    existing.port
                )),
            });
        }
        if guard.contains_key(&key) {
            return Ok(super::types::JoinResult {
                success: false,
                group: group.to_string(),
                error: Some("already joined".to_string()),
            });
        }
        guard.insert(key.clone(), jg);
    }

    Ok(super::types::JoinResult {
        success: true,
        group: group.to_string(),
        error: None,
    })
}

/// Leaves a multicast group. Stops audio receiver and generator first, then
/// cancels the listener and removes from ACTIVE_GROUPS.
pub async fn leave_group(group: &str) -> Result<super::types::LeaveResult, String> {
    let _span = tracing::info_span!("multicast.group_leave", group = %group).entered();
    // Stop audio receiver and generator before taking the lock on ACTIVE_GROUPS,
    // since their stop functions lock their own statics.
    let _ = super::audio_receiver::stop(group);
    let _ = super::audio_sender::stop(group);

    let mut guard = ACTIVE_GROUPS.lock().map_err(|e| format!("lock: {}", e))?;

    let found_key = guard
        .keys()
        .find(|k| {
            k.starts_with(group)
                && k.len() > group.len()
                && k.as_bytes()[group.len()] == b':'
        })
        .cloned();
    let key = match found_key {
        Some(k) => k,
        None => {
            return Ok(super::types::LeaveResult {
                success: false,
                group: group.to_string(),
                error: Some("group not found".to_string()),
            });
        }
    };

    if let Some(jg) = guard.remove(&key) {
        let _ = jg.cancel_tx.send(true);
        drop(jg);
        return Ok(super::types::LeaveResult {
            success: true,
            group: group.to_string(),
            error: None,
        });
    }

    Ok(super::types::LeaveResult {
        success: false,
        group: group.to_string(),
        error: Some("group not found".to_string()),
    })
}

/// Leaves a multicast group for an exact group:port key.
pub async fn leave_group_exact(group: &str, port: u16) -> Result<super::types::LeaveResult, String> {
    let _span = tracing::info_span!("multicast.group_leave_exact", group = %group, port = port).entered();
    let _ = super::audio_receiver::stop(group);
    let _ = super::audio_sender::stop(group);

    let mut guard = ACTIVE_GROUPS.lock().map_err(|e| format!("lock: {}", e))?;
    let key = group_key(group, port);

    if let Some(jg) = guard.remove(&key) {
        let _ = jg.cancel_tx.send(true);
        drop(jg);
        return Ok(super::types::LeaveResult {
            success: true,
            group: group.to_string(),
            error: None,
        });
    }

    Ok(super::types::LeaveResult {
        success: false,
        group: group.to_string(),
        error: Some(format!("group {}:{} not found", group, port)),
    })
}

/// Returns a cancel receiver for the given group:port so the caller can spawn the listener.
pub fn get_cancel_rx(
    group: &str,
    port: u16,
) -> Option<tokio::sync::watch::Receiver<bool>> {
    let guard = ACTIVE_GROUPS.lock().ok()?;
    let jg = guard.get(&group_key(group, port))?;
    Some(jg.cancel_tx.subscribe())
}

/// Returns a broadcast sender clone for the given group:port (used by the listener).
pub fn get_packet_tx(
    group: &str,
    port: u16,
) -> Option<tokio::sync::broadcast::Sender<PacketData>> {
    let guard = ACTIVE_GROUPS.lock().ok()?;
    let jg = guard.get(&group_key(group, port))?;
    Some(jg.packet_tx.clone())
}

/// Subscribe to raw packet data for the given group:port (used by audio receiver).
pub fn subscribe_packets(
    group: &str,
    port: u16,
) -> Option<tokio::sync::broadcast::Receiver<PacketData>> {
    let guard = ACTIVE_GROUPS.lock().ok()?;
    let jg = guard.get(&group_key(group, port))?;
    Some(jg.packet_tx.subscribe())
}

/// Returns the stored interface for the given group:port.
pub fn get_interface(group: &str, port: u16) -> Option<String> {
    let guard = ACTIVE_GROUPS.lock().ok()?;
    let jg = guard.get(&group_key(group, port))?;
    jg.interface.clone()
}

/// Returns current active multicast groups with stats.
pub fn list_groups() -> Vec<super::types::MulticastGroup> {
    let guard = match ACTIVE_GROUPS.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    guard
        .iter()
        .map(|(_, jg)| {
            let st = jg.stats.lock().map(|s| s.clone()).unwrap_or_default();
            super::types::MulticastGroup {
                group: jg.group.clone(),
                interface: jg.interface.clone(),
                port: jg.port,
                joined_at: jg.joined_at.to_rfc3339(),
                packets_received: st.packets_received,
                bytes_received: st.bytes_received,
                sources_seen: st.sources_seen,
            }
        })
        .collect()
}

/// Sends UDP test packets to a multicast group.
pub async fn send_test(
    group: &str,
    port: u16,
    count: u32,
    interval_ms: u32,
    ttl: Option<u8>,
) -> Result<super::types::SendTestResult, String> {
    let group_addr: std::net::Ipv4Addr = group
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if !group_addr.is_multicast() {
        return Err(format!("{} is not a multicast IPv4 address", group));
    }

    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| e.to_string())?;

    let sock_ref = socket2::SockRef::from(&socket);
    sock_ref
        .set_multicast_loop_v4(true)
        .map_err(|e| e.to_string())?;
    if let Some(t) = ttl {
        sock_ref.set_multicast_ttl_v4(t as u32).map_err(|e| e.to_string())?;
    }

    let bind_addr = SocketAddrV4::new(std::net::Ipv4Addr::new(0, 0, 0, 0), 0);
    socket
        .bind(&socket2::SockAddr::from(bind_addr))
        .map_err(|e| e.to_string())?;

    let dest = SocketAddrV4::new(group_addr, port);
    let payload: [u8; 64] = [0u8; 64];
    let start = Instant::now();
    let mut sent = 0u32;

    for _ in 0..count {
        socket
            .send_to(&payload, &socket2::SockAddr::from(dest))
            .map_err(|e| e.to_string())?;
        sent += 1;
        if interval_ms > 0 && sent < count {
            tokio::time::sleep(std::time::Duration::from_millis(interval_ms as u64)).await;
        }
    }

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    Ok(super::types::SendTestResult {
        success: true,
        group: group.to_string(),
        sent,
        elapsed_ms,
        error: None,
    })
}
