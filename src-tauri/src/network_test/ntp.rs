use serde::{Deserialize, Serialize};
use std::net::UdpSocket;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpConfig {
    pub servers: Vec<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpCheckResult {
    pub servers: Vec<NtpServerResult>,
    pub local_time: String,
    pub utc_time: String,
    pub clock_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NtpServerResult {
    pub server: String,
    pub stratum: u8,
    pub offset_ms: f64,
    pub delay_ms: f64,
    pub reference_id: String,
    pub success: bool,
    pub error: Option<String>,
}

const NTP_EPOCH_OFFSET: u64 = 2_208_988_800; // seconds from 1900 to 1970

#[tracing::instrument(skip_all)]
pub async fn run_ntp_check(config: NtpConfig) -> NtpCheckResult {
    let timeout = Duration::from_millis(config.timeout_ms);
    let mut results = Vec::new();
    let mut max_abs_offset: f64 = 0.0;

    for server in &config.servers {
        let server = server.clone();
        let server_for_err = server.clone();
        let result = tokio::task::spawn_blocking(move || query_ntp(&server, timeout))
            .await
            .unwrap_or_else(|e| NtpServerResult {
                server: server_for_err,
                stratum: 0,
                offset_ms: 0.0,
                delay_ms: 0.0,
                reference_id: String::new(),
                success: false,
                error: Some(format!("task error: {}", e)),
            });

        if result.success {
            let abs = result.offset_ms.abs();
            if abs > max_abs_offset {
                max_abs_offset = abs;
            }
        }
        results.push(result);
    }

    let now = chrono::Utc::now();
    let status = if max_abs_offset > 30_000.0 {
        "critical"
    } else if max_abs_offset > 1_000.0 {
        "warning"
    } else {
        "ok"
    };

    NtpCheckResult {
        servers: results,
        local_time: chrono::Local::now().to_rfc3339(),
        utc_time: now.to_rfc3339(),
        clock_status: status.to_string(),
    }
}

fn query_ntp(server: &str, timeout: Duration) -> NtpServerResult {
    let host = if server.contains(':') {
        server.to_string()
    } else {
        format!("{}:123", server)
    };

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => {
            return NtpServerResult {
                server: server.to_string(),
                stratum: 0, offset_ms: 0.0, delay_ms: 0.0,
                reference_id: String::new(), success: false,
                error: Some(format!("bind: {}", e)),
            };
        }
    };

    socket.set_read_timeout(Some(timeout)).ok();
    socket.set_write_timeout(Some(timeout)).ok();

    if let Err(e) = socket.connect(&host) {
        return NtpServerResult {
            server: server.to_string(),
            stratum: 0, offset_ms: 0.0, delay_ms: 0.0,
            reference_id: String::new(), success: false,
            error: Some(format!("connect: {}", e)),
        };
    }

    let mut req = [0u8; 48];
    req[0] = 0x23; // LI=0, VN=4, Mode=3 (client)

    let t1 = SystemTime::now();

    if let Err(e) = socket.send(&req) {
        return NtpServerResult {
            server: server.to_string(),
            stratum: 0, offset_ms: 0.0, delay_ms: 0.0,
            reference_id: String::new(), success: false,
            error: Some(format!("send: {}", e)),
        };
    }

    let mut resp = [0u8; 48];
    match socket.recv(&mut resp) {
        Ok(n) if n >= 48 => {}
        Ok(_) => {
            return NtpServerResult {
                server: server.to_string(),
                stratum: 0, offset_ms: 0.0, delay_ms: 0.0,
                reference_id: String::new(), success: false,
                error: Some("short response".to_string()),
            };
        }
        Err(e) => {
            return NtpServerResult {
                server: server.to_string(),
                stratum: 0, offset_ms: 0.0, delay_ms: 0.0,
                reference_id: String::new(), success: false,
                error: Some(format!("recv: {}", e)),
            };
        }
    }

    let t4 = SystemTime::now();

    let stratum = resp[1];
    let ref_id = format!("{}.{}.{}.{}", resp[12], resp[13], resp[14], resp[15]);

    let t2 = ntp_timestamp_to_duration(&resp[32..40]);
    let t3 = ntp_timestamp_to_duration(&resp[40..48]);

    let t1_dur = t1.duration_since(UNIX_EPOCH).unwrap_or_default();
    let t4_dur = t4.duration_since(UNIX_EPOCH).unwrap_or_default();

    let offset = ((t2.as_secs_f64() - t1_dur.as_secs_f64())
        + (t3.as_secs_f64() - t4_dur.as_secs_f64()))
        / 2.0;
    let delay = (t4_dur.as_secs_f64() - t1_dur.as_secs_f64())
        - (t3.as_secs_f64() - t2.as_secs_f64());

    NtpServerResult {
        server: server.to_string(),
        stratum,
        offset_ms: offset * 1000.0,
        delay_ms: delay * 1000.0,
        reference_id: ref_id,
        success: true,
        error: None,
    }
}

fn ntp_timestamp_to_duration(bytes: &[u8]) -> Duration {
    let secs = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let frac = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let unix_secs = (secs as u64).saturating_sub(NTP_EPOCH_OFFSET);
    let nanos = (frac as u64 * 1_000_000_000) >> 32;
    Duration::new(unix_secs, nanos as u32)
}
