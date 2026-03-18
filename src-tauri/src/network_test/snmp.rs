use serde::{Deserialize, Serialize};
use snmp2::{v3, Oid, SyncSession, Value};
use std::net::UdpSocket;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpConfig {
    pub host: String,
    pub community: String,
    pub version: u8,
    pub v3_username: Option<String>,
    pub v3_auth_password: Option<String>,
    pub v3_priv_password: Option<String>,
    pub v3_security_level: Option<SnmpV3SecurityLevel>,
    pub v3_auth_protocol: Option<SnmpV3AuthProtocol>,
    pub v3_privacy_protocol: Option<SnmpV3PrivacyProtocol>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SnmpV3SecurityLevel {
    NoAuthNoPriv,
    AuthNoPriv,
    AuthPriv,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnmpV3AuthProtocol {
    Md5,
    Sha1,
    Sha224,
    Sha256,
    Sha384,
    Sha512,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SnmpV3PrivacyProtocol {
    Des,
    Aes128,
    Aes192,
    Aes256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpPollResult {
    pub system_info: SnmpSystemInfo,
    pub interfaces: Vec<SnmpInterface>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnmpSystemInfo {
    pub sys_name: String,
    pub sys_descr: String,
    pub sys_uptime: String,
    pub sys_contact: String,
    pub sys_location: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnmpInterface {
    pub index: u32,
    pub description: String,
    #[serde(rename = "type")]
    pub if_type: String,
    pub speed: u64,
    pub oper_status: String,
    pub in_octets: u64,
    pub out_octets: u64,
    pub in_errors: u64,
    pub out_errors: u64,
    pub in_discards: u64,
    pub out_discards: u64,
}

impl Default for SnmpConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            community: "public".to_string(),
            version: 2,
            v3_username: None,
            v3_auth_password: None,
            v3_priv_password: None,
            v3_security_level: None,
            v3_auth_protocol: None,
            v3_privacy_protocol: None,
        }
    }
}

pub async fn run_snmp_poll(config: SnmpConfig) -> SnmpPollResult {
    let result = tokio::task::spawn_blocking(move || run_snmp_poll_blocking(config))
        .await
        .unwrap_or_else(|_| SnmpPollResult {
            system_info: SnmpSystemInfo::default(),
            interfaces: vec![],
            elapsed_ms: 0,
        });
    result
}

fn run_snmp_poll_blocking(config: SnmpConfig) -> SnmpPollResult {
    let start = std::time::Instant::now();
    if config.version == 3 {
        return run_snmp_poll_v3(config, start);
    }

    let host = if config.host.contains(':') {
        config.host.clone()
    } else {
        format!("{}:161", config.host)
    };

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => {
            return SnmpPollResult {
                system_info: SnmpSystemInfo::default(),
                interfaces: vec![],
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
    };
    socket.set_read_timeout(Some(Duration::from_secs(3))).ok();
    socket.connect(&host).ok();

    let community = config.community.as_bytes();
    let mut sys = SnmpSystemInfo::default();

    // System MIB queries
    let sys_oids = [
        ("1.3.6.1.2.1.1.5.0", &mut sys.sys_name as &mut String),
        ("1.3.6.1.2.1.1.1.0", &mut sys.sys_descr),
        ("1.3.6.1.2.1.1.3.0", &mut sys.sys_uptime),
        ("1.3.6.1.2.1.1.4.0", &mut sys.sys_contact),
        ("1.3.6.1.2.1.1.6.0", &mut sys.sys_location),
    ];

    for (oid, target) in sys_oids {
        if let Some(val) = snmp_get(&socket, community, config.version, oid) {
            *target = val;
        }
    }

    let mut interfaces: Vec<SnmpInterface> = Vec::new();
    let mut misses = 0u32;
    const MAX_IF_INDEX: u32 = 96;

    for index in 1..=MAX_IF_INDEX {
        let base = format!("1.3.6.1.2.1.2.2.1");
        let descr_oid = format!("{}.2.{}", base, index);
        let Some(description) = snmp_get(&socket, community, config.version, &descr_oid) else {
            misses += 1;
            if index > 24 && misses > 16 {
                break;
            }
            continue;
        };
        misses = 0;

        let if_type_raw = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.3.{}", base, index),
        )
        .unwrap_or_default();
        let speed = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.5.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let oper_status = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.8.{}", base, index),
        )
        .map(|v| map_oper_status(v.parse::<u64>().unwrap_or(0)))
        .unwrap_or_else(|| "unknown".to_string());
        let in_octets = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.10.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let in_discards = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.13.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let in_errors = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.14.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let out_octets = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.16.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let out_discards = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.19.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
        let out_errors = snmp_get(
            &socket,
            community,
            config.version,
            &format!("{}.20.{}", base, index),
        )
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

        interfaces.push(SnmpInterface {
            index,
            description,
            if_type: map_if_type(if_type_raw.parse::<u64>().unwrap_or(0)),
            speed,
            oper_status,
            in_octets,
            out_octets,
            in_errors,
            out_errors,
            in_discards,
            out_discards,
        });
    }

    interfaces.sort_by_key(|i| i.index);

    SnmpPollResult {
        system_info: sys,
        interfaces,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

fn run_snmp_poll_v3(config: SnmpConfig, start: std::time::Instant) -> SnmpPollResult {
    let host = if config.host.contains(':') {
        config.host.clone()
    } else {
        format!("{}:161", config.host)
    };

    let username = config.v3_username.as_deref().unwrap_or("").trim();
    if username.is_empty() {
        return SnmpPollResult {
            system_info: SnmpSystemInfo::default(),
            interfaces: vec![],
            elapsed_ms: start.elapsed().as_millis() as u64,
        };
    }

    let auth_password = config
        .v3_auth_password
        .unwrap_or_default()
        .into_bytes();
    let privacy_password = config
        .v3_priv_password
        .unwrap_or_default()
        .into_bytes();
    let security_level = config
        .v3_security_level
        .unwrap_or(SnmpV3SecurityLevel::AuthNoPriv);
    let auth_protocol = map_v3_auth_protocol(
        config
            .v3_auth_protocol
            .unwrap_or(SnmpV3AuthProtocol::Sha256),
    );
    let privacy_protocol = map_v3_privacy_protocol(
        config
            .v3_privacy_protocol
            .unwrap_or(SnmpV3PrivacyProtocol::Aes128),
    );

    let mut security = v3::Security::new(username.as_bytes(), &auth_password)
        .with_auth_protocol(auth_protocol);
    security = match security_level {
        SnmpV3SecurityLevel::NoAuthNoPriv => security.with_auth(v3::Auth::NoAuthNoPriv),
        SnmpV3SecurityLevel::AuthNoPriv => security.with_auth(v3::Auth::AuthNoPriv),
        SnmpV3SecurityLevel::AuthPriv => security.with_auth(v3::Auth::AuthPriv {
            cipher: privacy_protocol,
            privacy_password,
        }),
    };

    let mut session = match SyncSession::new_v3(
        host.as_str(),
        Some(Duration::from_secs(3)),
        0,
        security,
    ) {
        Ok(s) => s,
        Err(_) => {
            return SnmpPollResult {
                system_info: SnmpSystemInfo::default(),
                interfaces: vec![],
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    // Resolve and synchronize authoritative engine state.
    loop {
        match session.init() {
            Ok(()) => break,
            Err(snmp2::Error::AuthUpdated) => continue,
            Err(_) => {
                return SnmpPollResult {
                    system_info: SnmpSystemInfo::default(),
                    interfaces: vec![],
                    elapsed_ms: start.elapsed().as_millis() as u64,
                };
            }
        }
    }

    let mut sys = SnmpSystemInfo::default();
    let sys_oids = [
        ("1.3.6.1.2.1.1.5.0", &mut sys.sys_name as &mut String),
        ("1.3.6.1.2.1.1.1.0", &mut sys.sys_descr),
        ("1.3.6.1.2.1.1.3.0", &mut sys.sys_uptime),
        ("1.3.6.1.2.1.1.4.0", &mut sys.sys_contact),
        ("1.3.6.1.2.1.1.6.0", &mut sys.sys_location),
    ];
    for (oid, target) in sys_oids {
        if let Some(val) = snmp_get_v3_string(&mut session, oid) {
            *target = val;
        }
    }

    let mut interfaces: Vec<SnmpInterface> = Vec::new();
    let mut misses = 0u32;
    const MAX_IF_INDEX: u32 = 96;
    for index in 1..=MAX_IF_INDEX {
        let base = "1.3.6.1.2.1.2.2.1";
        let descr_oid = format!("{base}.2.{index}");
        let Some(description) = snmp_get_v3_string(&mut session, &descr_oid) else {
            misses += 1;
            if index > 24 && misses > 16 {
                break;
            }
            continue;
        };
        misses = 0;

        let if_type_raw =
            snmp_get_v3_u64(&mut session, &format!("{base}.3.{index}")).unwrap_or(0);
        let speed = snmp_get_v3_u64(&mut session, &format!("{base}.5.{index}")).unwrap_or(0);
        let oper_status = map_oper_status(
            snmp_get_v3_u64(&mut session, &format!("{base}.8.{index}")).unwrap_or(0),
        );
        let in_octets =
            snmp_get_v3_u64(&mut session, &format!("{base}.10.{index}")).unwrap_or(0);
        let in_discards =
            snmp_get_v3_u64(&mut session, &format!("{base}.13.{index}")).unwrap_or(0);
        let in_errors =
            snmp_get_v3_u64(&mut session, &format!("{base}.14.{index}")).unwrap_or(0);
        let out_octets =
            snmp_get_v3_u64(&mut session, &format!("{base}.16.{index}")).unwrap_or(0);
        let out_discards =
            snmp_get_v3_u64(&mut session, &format!("{base}.19.{index}")).unwrap_or(0);
        let out_errors =
            snmp_get_v3_u64(&mut session, &format!("{base}.20.{index}")).unwrap_or(0);

        interfaces.push(SnmpInterface {
            index,
            description,
            if_type: map_if_type(if_type_raw),
            speed,
            oper_status,
            in_octets,
            out_octets,
            in_errors,
            out_errors,
            in_discards,
            out_discards,
        });
    }

    interfaces.sort_by_key(|i| i.index);
    SnmpPollResult {
        system_info: sys,
        interfaces,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

fn map_v3_auth_protocol(proto: SnmpV3AuthProtocol) -> v3::AuthProtocol {
    match proto {
        SnmpV3AuthProtocol::Md5 => v3::AuthProtocol::Md5,
        SnmpV3AuthProtocol::Sha1 => v3::AuthProtocol::Sha1,
        SnmpV3AuthProtocol::Sha224 => v3::AuthProtocol::Sha224,
        SnmpV3AuthProtocol::Sha256 => v3::AuthProtocol::Sha256,
        SnmpV3AuthProtocol::Sha384 => v3::AuthProtocol::Sha384,
        SnmpV3AuthProtocol::Sha512 => v3::AuthProtocol::Sha512,
    }
}

fn map_v3_privacy_protocol(proto: SnmpV3PrivacyProtocol) -> v3::Cipher {
    match proto {
        SnmpV3PrivacyProtocol::Des => v3::Cipher::Des,
        SnmpV3PrivacyProtocol::Aes128 => v3::Cipher::Aes128,
        SnmpV3PrivacyProtocol::Aes192 => v3::Cipher::Aes192,
        SnmpV3PrivacyProtocol::Aes256 => v3::Cipher::Aes256,
    }
}

fn parse_oid(oid: &str) -> Option<Oid<'static>> {
    let parts: Vec<u64> = oid.split('.').filter_map(|s| s.parse::<u64>().ok()).collect();
    Oid::from(&parts).ok()
}

fn snmp_get_v3_string(session: &mut SyncSession, oid: &str) -> Option<String> {
    let parsed = parse_oid(oid)?;
    for _ in 0..3 {
        let mut pdu = match session.get(&parsed) {
            Ok(pdu) => pdu,
            Err(snmp2::Error::AuthUpdated) => continue,
            Err(_) => return None,
        };
        if let Some((_name, value)) = pdu.varbinds.next() {
            return Some(match value {
                Value::OctetString(v) => String::from_utf8_lossy(v).to_string(),
                Value::Integer(v) => v.to_string(),
                Value::Counter32(v) => v.to_string(),
                Value::Unsigned32(v) => v.to_string(),
                Value::Counter64(v) => v.to_string(),
                Value::Timeticks(v) => {
                    let secs = u64::from(v) / 100;
                    let d = secs / 86400;
                    let h = (secs % 86400) / 3600;
                    let m = (secs % 3600) / 60;
                    format!("{d}d {h}h {m}m")
                }
                Value::IpAddress(v) => format!("{}.{}.{}.{}", v[0], v[1], v[2], v[3]),
                Value::ObjectIdentifier(oid) => format!("{oid}"),
                Value::NoSuchObject | Value::NoSuchInstance | Value::EndOfMibView => String::new(),
                _ => String::new(),
            });
        }
    }
    None
}

fn snmp_get_v3_u64(session: &mut SyncSession, oid: &str) -> Option<u64> {
    let parsed = parse_oid(oid)?;
    for _ in 0..3 {
        let mut pdu = match session.get(&parsed) {
            Ok(pdu) => pdu,
            Err(snmp2::Error::AuthUpdated) => continue,
            Err(_) => return None,
        };
        if let Some((_name, value)) = pdu.varbinds.next() {
            return match value {
                Value::Integer(v) => Some(v.max(0) as u64),
                Value::Counter32(v) => Some(v as u64),
                Value::Unsigned32(v) => Some(v as u64),
                Value::Counter64(v) => Some(v),
                Value::Timeticks(v) => Some(v as u64),
                Value::OctetString(v) => String::from_utf8_lossy(v).parse::<u64>().ok(),
                _ => None,
            };
        }
    }
    None
}

fn snmp_get(socket: &UdpSocket, community: &[u8], version: u8, oid: &str) -> Option<String> {
    let oid_bytes = encode_oid(oid);
    let req_id: u32 = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() & 0x7FFF_FFFF) as u32;

    let req_id_ber = ber_integer(req_id);
    let zero = ber_integer(0);

    // VarBind: SEQUENCE { OID, NULL }
    let mut varbind = Vec::new();
    varbind.extend_from_slice(&oid_bytes);
    varbind.extend_from_slice(&[0x05, 0x00]); // NULL
    let varbind_seq = ber_sequence(&varbind);
    let varbindlist = ber_sequence(&varbind_seq);

    // PDU: GetRequest (0xA0)
    let mut pdu_content = Vec::new();
    pdu_content.extend_from_slice(&req_id_ber);
    pdu_content.extend_from_slice(&zero); // error-status
    pdu_content.extend_from_slice(&zero); // error-index
    pdu_content.extend_from_slice(&varbindlist);
    let pdu = ber_tagged(0xA0, &pdu_content);

    // Message: SEQUENCE { version(1), community, pdu }
    let mut msg_content = Vec::new();
    // SNMP version in protocol: v1=0, v2c=1. Default to v2c.
    let version_ber = if version == 1 { 0 } else { 1 };
    msg_content.extend_from_slice(&ber_integer(version_ber));
    msg_content.extend_from_slice(&ber_octet_string(community));
    msg_content.extend_from_slice(&pdu);
    let msg = ber_sequence(&msg_content);

    socket.send(&msg).ok()?;

    let mut buf = [0u8; 4096];
    let n = socket.recv(&mut buf).ok()?;
    parse_snmp_value(&buf[..n])
}

fn map_oper_status(code: u64) -> String {
    match code {
        1 => "up".to_string(),
        2 => "down".to_string(),
        3 => "testing".to_string(),
        4 => "unknown".to_string(),
        5 => "dormant".to_string(),
        6 => "notPresent".to_string(),
        7 => "lowerLayerDown".to_string(),
        _ => "unknown".to_string(),
    }
}

fn map_if_type(code: u64) -> String {
    match code {
        6 => "ethernetCsmacd".to_string(),
        23 => "ppp".to_string(),
        24 => "softwareLoopback".to_string(),
        37 => "atm".to_string(),
        53 => "propVirtual".to_string(),
        71 => "ieee80211".to_string(),
        131 => "tunnel".to_string(),
        135 => "l2vlan".to_string(),
        136 => "l3ipvlan".to_string(),
        _ if code > 0 => format!("ifType({code})"),
        _ => "unknown".to_string(),
    }
}

fn parse_snmp_value(data: &[u8]) -> Option<String> {
    if data.len() < 20 || data[0] != 0x30 {
        return None;
    }
    // Walk through BER to find the value. Very simplified.
    // Skip: outer SEQUENCE, version INTEGER, community OCTET STRING, PDU,
    // reqID, error-status, error-index, varbindlist, varbind, OID
    // Then read the value.
    let mut idx = 0;
    idx = skip_ber_header(data, idx)?; // outer SEQUENCE
    idx = skip_ber_tlv(data, idx)?;    // version
    idx = skip_ber_tlv(data, idx)?;    // community
    idx = skip_ber_header(data, idx)?; // PDU
    idx = skip_ber_tlv(data, idx)?;    // reqID
    idx = skip_ber_tlv(data, idx)?;    // error-status
    idx = skip_ber_tlv(data, idx)?;    // error-index
    idx = skip_ber_header(data, idx)?; // varbindlist
    idx = skip_ber_header(data, idx)?; // varbind
    idx = skip_ber_tlv(data, idx)?;    // OID

    // Now at the value
    if idx >= data.len() {
        return None;
    }
    let tag = data[idx];
    idx += 1;
    let (len, new_idx) = ber_decode_length(data, idx)?;
    idx = new_idx;
    if idx + len > data.len() {
        return None;
    }
    let val_bytes = &data[idx..idx + len];

    match tag {
        0x04 => Some(String::from_utf8_lossy(val_bytes).to_string()),
        0x02 | 0x41 | 0x42 | 0x43 | 0x46 => {
            let mut val: u64 = 0;
            for &b in val_bytes {
                val = (val << 8) | b as u64;
            }
            if tag == 0x43 {
                // TimeTicks
                let secs = val / 100;
                let d = secs / 86400;
                let h = (secs % 86400) / 3600;
                let m = (secs % 3600) / 60;
                Some(format!("{}d {}h {}m", d, h, m))
            } else {
                Some(val.to_string())
            }
        }
        _ => Some(format!("(0x{:02X})", tag)),
    }
}

fn skip_ber_header(data: &[u8], idx: usize) -> Option<usize> {
    if idx >= data.len() { return None; }
    let (_, new_idx) = ber_decode_length(data, idx + 1)?;
    Some(new_idx)
}

fn skip_ber_tlv(data: &[u8], idx: usize) -> Option<usize> {
    if idx >= data.len() { return None; }
    let (len, new_idx) = ber_decode_length(data, idx + 1)?;
    Some(new_idx + len)
}

fn ber_decode_length(data: &[u8], idx: usize) -> Option<(usize, usize)> {
    if idx >= data.len() { return None; }
    let b = data[idx];
    if b < 0x80 {
        Some((b as usize, idx + 1))
    } else {
        let num_bytes = (b & 0x7F) as usize;
        let mut length = 0usize;
        for i in 0..num_bytes {
            if idx + 1 + i >= data.len() { return None; }
            length = (length << 8) | data[idx + 1 + i] as usize;
        }
        Some((length, idx + 1 + num_bytes))
    }
}

fn ber_encode_length(length: usize) -> Vec<u8> {
    if length < 0x80 {
        vec![length as u8]
    } else if length <= 0xFF {
        vec![0x81, length as u8]
    } else {
        vec![0x82, (length >> 8) as u8, length as u8]
    }
}

fn ber_sequence(content: &[u8]) -> Vec<u8> {
    let mut result = vec![0x30];
    result.extend_from_slice(&ber_encode_length(content.len()));
    result.extend_from_slice(content);
    result
}

fn ber_tagged(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut result = vec![tag];
    result.extend_from_slice(&ber_encode_length(content.len()));
    result.extend_from_slice(content);
    result
}

fn ber_integer(val: u32) -> Vec<u8> {
    if val == 0 {
        return vec![0x02, 0x01, 0x00];
    }
    let mut bytes = Vec::new();
    let mut v = val;
    while v > 0 {
        bytes.insert(0, (v & 0xFF) as u8);
        v >>= 8;
    }
    if bytes[0] & 0x80 != 0 {
        bytes.insert(0, 0x00);
    }
    let mut result = vec![0x02];
    result.extend_from_slice(&ber_encode_length(bytes.len()));
    result.extend_from_slice(&bytes);
    result
}

fn ber_octet_string(val: &[u8]) -> Vec<u8> {
    let mut result = vec![0x04];
    result.extend_from_slice(&ber_encode_length(val.len()));
    result.extend_from_slice(val);
    result
}

fn encode_oid(oid: &str) -> Vec<u8> {
    let parts: Vec<u32> = oid.split('.').filter_map(|s| s.parse().ok()).collect();
    if parts.len() < 2 {
        return vec![0x06, 0x01, 0x00];
    }
    let mut encoded = vec![(parts[0] * 40 + parts[1]) as u8];
    for &n in &parts[2..] {
        if n < 128 {
            encoded.push(n as u8);
        } else {
            let mut bytes = Vec::new();
            let mut v = n;
            bytes.push((v & 0x7F) as u8);
            v >>= 7;
            while v > 0 {
                bytes.push((v & 0x7F) as u8 | 0x80);
                v >>= 7;
            }
            bytes.reverse();
            encoded.extend_from_slice(&bytes);
        }
    }
    let mut result = vec![0x06];
    result.extend_from_slice(&ber_encode_length(encoded.len()));
    result.extend_from_slice(&encoded);
    result
}
