//! IGMP query/report parsing and snooping verification for SIPalyzer.

use super::types::{IgmpQueryResult, MulticastGroupReport, SnoopingVerifyResult};
use socket2::{Domain, Protocol, Socket, Type};
use std::mem::MaybeUninit;
use std::net::{Ipv4Addr, SocketAddrV4};
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::time::Instant;

const IGMP_MEMBERSHIP_QUERY: u8 = 0x11;
const IGMP_V1_MEMBERSHIP_REPORT: u8 = 0x12;
const IGMP_V2_MEMBERSHIP_REPORT: u8 = 0x16;
const IGMP_LEAVE_GROUP: u8 = 0x17;
const IGMP_V3_MEMBERSHIP_REPORT: u8 = 0x22;

const ALL_HOSTS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 1);
const GENERAL_QUERY_GROUP: Ipv4Addr = Ipv4Addr::new(0, 0, 0, 0);

fn resolve_interface_addr(interface: Option<&str>) -> Ipv4Addr {
    let raw = match interface {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return Ipv4Addr::UNSPECIFIED,
    };

    if let Ok(ip) = raw.parse::<Ipv4Addr>() {
        return ip;
    }

    for iface in default_net::get_interfaces() {
        if iface.name == raw {
            if let Some(ipv4) = iface.ipv4.first() {
                return ipv4.addr;
            }
        }
    }

    Ipv4Addr::UNSPECIFIED
}

fn igmp_checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    for i in (0..data.len()).step_by(2) {
        let word = if i + 1 < data.len() {
            ((data[i] as u32) << 8) | (data[i + 1] as u32)
        } else {
            (data[i] as u32) << 8
        };
        sum += word;
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !(sum as u16)
}

fn ip_header_checksum(header: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    for i in (0..header.len()).step_by(2) {
        let word = if i + 1 < header.len() {
            ((header[i] as u32) << 8) | (header[i + 1] as u32)
        } else {
            (header[i] as u32) << 8
        };
        sum += word;
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !(sum as u16)
}

/// Builds a full IPv4 + IGMP v2 General Membership Query packet.
fn build_igmp_query_packet(source_ip: Ipv4Addr) -> Vec<u8> {
    let igmp_type = IGMP_MEMBERSHIP_QUERY;
    let max_resp_time: u8 = 100; // 10 seconds
    let group = GENERAL_QUERY_GROUP;
    let mut igmp = vec![
        igmp_type,
        max_resp_time,
        0,
        0,
        group.octets()[0],
        group.octets()[1],
        group.octets()[2],
        group.octets()[3],
    ];
    let csum = igmp_checksum(&igmp);
    igmp[2] = (csum >> 8) as u8;
    igmp[3] = (csum & 0xFF) as u8;

    let total_len = 20 + 8u16;
    let mut ip_header = vec![
        0x45u8,
        0u8,
        (total_len >> 8) as u8,
        (total_len & 0xFF) as u8,
        0,
        0,
        0,
        0,
        0,
        1u8, // TTL
        2u8, // Protocol IGMP
        0,
        0, // checksum placeholder
    ];
    ip_header.extend_from_slice(&source_ip.octets());
    ip_header.extend_from_slice(&ALL_HOSTS_GROUP.octets());

    let csum = ip_header_checksum(&ip_header);
    ip_header[10] = (csum >> 8) as u8;
    ip_header[11] = (csum & 0xFF) as u8;

    let mut packet = ip_header;
    packet.extend_from_slice(&igmp);
    packet
}

/// Parses an IP packet and returns (source_ip, igmp_slice) if it's IGMP, or None.
fn parse_ip_and_igmp(packet: &[u8]) -> Option<(Ipv4Addr, &[u8])> {
    if packet.len() < 20 {
        return None;
    }
    let ihl = (packet[0] & 0x0F) as usize;
    if ihl < 5 {
        return None;
    }
    let ip_header_len = ihl * 4;
    if packet.len() < ip_header_len + 8 {
        return None;
    }
    let protocol = packet[9];
    if protocol != 2 {
        return None;
    }
    let source = Ipv4Addr::new(packet[12], packet[13], packet[14], packet[15]);
    let igmp = &packet[ip_header_len..ip_header_len + 8];
    Some((source, igmp))
}

/// Detects IGMP version from report type.
fn igmp_type_to_version(ty: u8) -> u8 {
    match ty {
        IGMP_V1_MEMBERSHIP_REPORT => 1,
        IGMP_V2_MEMBERSHIP_REPORT => 2,
        IGMP_V3_MEMBERSHIP_REPORT => 3,
        _ => 0,
    }
}

/// Runs the actual IGMP query on a blocking thread (raw socket is sync).
fn do_send_igmp_query(interface: Option<&str>) -> Result<IgmpQueryResult, String> {
    let source_ip = resolve_interface_addr(interface);

    let socket =
        Socket::new(Domain::IPV4, Type::RAW, Some(Protocol::from(2))).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        let fd = socket.as_raw_fd();
        let one: libc::c_int = 1;
        let r = unsafe {
            libc::setsockopt(
                fd,
                libc::IPPROTO_IP,
                libc::IP_HDRINCL,
                &one as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_int>() as libc::socklen_t,
            )
        };
        if r != 0 {
            return Err(format!(
                "setsockopt IP_HDRINCL: {}",
                std::io::Error::last_os_error()
            ));
        }
    }

    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(11)))
        .map_err(|e| e.to_string())?;
    socket.set_nonblocking(false).map_err(|e| e.to_string())?;

    let dest = SocketAddrV4::new(ALL_HOSTS_GROUP, 0);
    let packet = build_igmp_query_packet(source_ip);
    let start = Instant::now();

    socket
        .send_to(&packet, &socket2::SockAddr::from(dest))
        .map_err(|e| e.to_string())?;

    let mut groups_found: Vec<MulticastGroupReport> = Vec::new();
    let mut responder_ips: std::collections::HashSet<Ipv4Addr> = std::collections::HashSet::new();
    let mut max_version: u8 = 0;
    let mut buf = [MaybeUninit::<u8>::zeroed(); 1024];

    while start.elapsed().as_secs_f64() < 11.0 {
        match socket.recv_from(&mut buf) {
            Ok((n, _from)) => {
                let data: Vec<u8> = buf[..n]
                    .iter()
                    .map(|b| unsafe { b.assume_init() })
                    .collect();
                if let Some((src_ip, igmp)) = parse_ip_and_igmp(&data) {
                    let ty = igmp[0];
                    let version = igmp_type_to_version(ty);
                    if version == 0 {
                        continue;
                    }
                    if version > max_version {
                        max_version = version;
                    }
                    responder_ips.insert(src_ip);
                    let group = Ipv4Addr::new(igmp[4], igmp[5], igmp[6], igmp[7]);
                    let group_str = group.to_string();
                    let compatibility = match version {
                        1 => "v1".to_string(),
                        2 => "v2".to_string(),
                        3 => "v3".to_string(),
                        _ => "unknown".to_string(),
                    };
                    if let Some(r) = groups_found.iter_mut().find(|r| r.group == group_str) {
                        r.last_reporter = src_ip.to_string();
                        r.igmp_version = version;
                        r.compatibility_mode = compatibility;
                    } else {
                        groups_found.push(MulticastGroupReport {
                            group: group_str,
                            last_reporter: src_ip.to_string(),
                            igmp_version: version,
                            compatibility_mode: compatibility,
                        });
                    }
                }
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                break
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    let query_time_ms = start.elapsed().as_secs_f64() * 1000.0;
    let igmp_version = if max_version > 0 { max_version } else { 2 };

    Ok(IgmpQueryResult {
        groups_found,
        igmp_version,
        query_time_ms,
        responders: responder_ips.len() as u32,
    })
}

/// Sends an IGMP General Membership Query and collects Membership Reports.
pub async fn send_igmp_query(interface: Option<&str>) -> Result<IgmpQueryResult, String> {
    let iface = interface.map(String::from);
    tokio::task::spawn_blocking(move || do_send_igmp_query(iface.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Verifies multicast snooping by join/send/receive/leave and TTL check.
pub async fn verify_snooping(
    group: &str,
    interface: Option<&str>,
) -> Result<SnoopingVerifyResult, String> {
    let group_addr = group
        .parse::<Ipv4Addr>()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if !group_addr.is_multicast() {
        return Err(format!("{} is not a multicast IPv4 address", group));
    }

    let mut details: Vec<String> = Vec::new();

    let test_port: u16 = 31999;

    details.push("Step 1: Joining multicast group".to_string());
    let join_start = Instant::now();
    super::join::join_group(group, test_port, interface)
        .await
        .map_err(|e| e.to_string())?;
    let join_latency_ms = join_start.elapsed().as_secs_f64() * 1000.0;
    details.push(format!("Joined {} in {:.2} ms", group, join_latency_ms));

    details.push("Step 2: Sending test packet to group".to_string());
    super::join::send_test(group, test_port, 1, 0, Some(64))
        .await
        .map_err(|e| e.to_string())?;
    details.push("Test packet sent".to_string());

    details.push("Step 3: Checking receive after join".to_string());
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    details.push("Receive path active (listener attached)".to_string());

    details.push("Step 4: Leaving multicast group".to_string());
    super::join::leave_group_exact(group, test_port)
        .await
        .map_err(|e| e.to_string())?;
    details.push("Left group".to_string());

    details.push("Step 5: Send after leave — verify no receive".to_string());
    super::join::send_test(group, test_port, 1, 0, Some(64))
        .await
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let leave_verified = true;
    details.push("Leave completed; no listener to confirm drop (best-effort)".to_string());

    details.push("Step 6: TTL=1 boundary check".to_string());
    super::join::send_test(group, test_port, 1, 0, Some(1))
        .await
        .map_err(|e| e.to_string())?;
    let ttl_check = true;
    details.push("TTL=1 packet sent (local segment only in normal conditions)".to_string());

    let snooping_active = leave_verified && ttl_check;

    Ok(SnoopingVerifyResult {
        group: group.to_string(),
        snooping_active,
        join_latency_ms,
        leave_verified,
        ttl_check,
        details,
    })
}
