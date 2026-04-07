//! Multicast packet listener: single socket per group:port. Receives packets,
//! emits Tauri events, and broadcasts raw data to subscribers (e.g. audio receiver).

use std::collections::HashSet;
use std::time::Instant;
use tauri::Emitter;
use tokio::net::UdpSocket;

use super::join;
use super::types::{ListenerStats, MulticastPacketEvent, PacketData};

const PACKET_BATCH_INTERVAL_MS: u64 = 120;
const PACKET_BATCH_MAX: usize = 96;

fn flush_packet_batch(app: &tauri::AppHandle, pending: &mut Vec<MulticastPacketEvent>) {
    if pending.is_empty() {
        return;
    }
    let batch = std::mem::take(pending);
    let _ = app.emit("multicast:packet-batch", batch);
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

/// Listens for multicast packets on the given group/port and emits events.
/// Broadcasts raw packet data to any subscribers via `packet_tx`.
/// Signals readiness (or failure) through `ready_tx` after socket setup.
pub async fn start_listener(
    app: tauri::AppHandle,
    group: &str,
    port: u16,
    interface: Option<&str>,
    packet_tx: tokio::sync::broadcast::Sender<PacketData>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
    ready_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let group_addr: std::net::Ipv4Addr = group
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if !group_addr.is_multicast() {
        let msg = format!(
            "[multicast listener] {} is not a multicast IPv4 address",
            group
        );
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }

    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|e| format!("[multicast listener] socket create: {}", e))?;

    socket
        .set_reuse_address(true)
        .map_err(|e| format!("[multicast listener] reuse_addr: {}", e))?;
    #[cfg(unix)]
    socket
        .set_reuse_port(true)
        .map_err(|e| format!("[multicast listener] reuse_port: {}", e))?;

    let bind_addr = std::net::SocketAddrV4::new(std::net::Ipv4Addr::UNSPECIFIED, port);
    if let Err(e) = socket.bind(&socket2::SockAddr::from(bind_addr)) {
        let msg = format!("[multicast listener] bind 0.0.0.0:{}: {}", port, e);
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }

    let interface_addr = resolve_interface_addr(interface);

    let sock_ref = socket2::SockRef::from(&socket);
    if let Err(e) = sock_ref.join_multicast_v4(&group_addr, &interface_addr) {
        let msg = format!("[multicast listener] join {}: {}", group, e);
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }
    if let Err(e) = sock_ref.set_multicast_loop_v4(true) {
        let msg = format!("[multicast listener] loopback: {}", e);
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }

    tracing::info!("Listening on {}:{} interface={:?}", group, port, interface);

    // Signal success — the socket is bound and joined
    let _ = ready_tx.send(Ok(()));

    #[cfg(unix)]
    let std_socket = {
        use std::os::unix::io::{FromRawFd, IntoRawFd};
        let fd = socket.into_raw_fd();
        unsafe { std::net::UdpSocket::from_raw_fd(fd) }
    };

    #[cfg(windows)]
    let std_socket = {
        use std::os::windows::io::{FromRawSocket, IntoRawSocket};
        let raw = socket.into_raw_socket();
        unsafe { std::net::UdpSocket::from_raw_socket(raw) }
    };

    std_socket
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let udp = UdpSocket::from_std(std_socket).map_err(|e| e.to_string())?;

    let key = format!("{}:{}", group, port);
    let mut buf = [0u8; 65535];
    let mut packet_count: u64 = 0;
    let mut byte_count: u64 = 0;
    let mut unique_sources: HashSet<String> = HashSet::new();
    let start = Instant::now();
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut packet_batch_interval =
        tokio::time::interval(std::time::Duration::from_millis(PACKET_BATCH_INTERVAL_MS));
    packet_batch_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut packets_this_sec: u64 = 0;
    let mut bytes_this_sec: u64 = 0;
    let mut pending_packet_events: Vec<MulticastPacketEvent> =
        Vec::with_capacity(PACKET_BATCH_MAX * 2);

    loop {
        tokio::select! {
            biased;

            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    flush_packet_batch(&app, &mut pending_packet_events);
                    break;
                }
            }

            _ = interval.tick() => {
                let secs = 1.0;
                let packets_per_sec = packets_this_sec as f64 / secs;
                let bytes_per_sec = bytes_this_sec as f64 / secs;
                let duration_secs = start.elapsed().as_secs_f64();

                let stats = ListenerStats {
                    group: group.to_string(),
                    packets_per_sec,
                    bytes_per_sec,
                    unique_sources: unique_sources.len() as u32,
                    duration_secs,
                };
                let _ = app.emit("multicast:listener-stats", stats);

                join::update_group_stats(
                    &key,
                    packet_count,
                    byte_count,
                    &unique_sources.iter().cloned().collect::<Vec<_>>(),
                );

                packets_this_sec = 0;
                bytes_this_sec = 0;
            }

            _ = packet_batch_interval.tick() => {
                flush_packet_batch(&app, &mut pending_packet_events);
            }

            res = udp.recv_from(&mut buf) => {
                let (n, peer) = match res {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::error!("recv_from error: {}", e);
                        continue;
                    }
                };
                let source_ip = peer.ip().to_string();
                let size = n as u32;

                packet_count += 1;
                byte_count += n as u64;
                unique_sources.insert(source_ip.clone());
                packets_this_sec += 1;
                bytes_this_sec += n as u64;

                let ttl = 0u8;
                let evt = MulticastPacketEvent {
                    group: group.to_string(),
                    source_ip: source_ip.clone(),
                    size,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    ttl,
                };
                pending_packet_events.push(evt);
                if pending_packet_events.len() >= PACKET_BATCH_MAX {
                    flush_packet_batch(&app, &mut pending_packet_events);
                }

                // Broadcast raw packet data to subscribers (audio receiver, etc.)
                let _ = packet_tx.send(PacketData {
                    data: buf[..n].to_vec(),
                    source_ip,
                });
            }
        }
    }

    Ok(())
}
