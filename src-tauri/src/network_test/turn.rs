use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, UdpSocket, ToSocketAddrs};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnConfig {
    pub server: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnResult {
    pub server: String,
    pub reachable: bool,
    pub response_ms: Option<f64>,
    pub allocated_address: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for TurnConfig {
    fn default() -> Self {
        Self {
            server: String::new(),
            port: 3478,
            username: None,
            password: None,
        }
    }
}

/// Tests TURN server connectivity by sending an Allocate request.
/// This is a simplified test that checks if the server responds.
pub async fn run_turn_test(config: TurnConfig) -> TurnResult {
    let server = config.server.clone();
    let port = config.port;

    let result = tokio::task::spawn_blocking(move || {
        turn_allocate_test(&server, port)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task error: {}", e)));

    match result {
        Ok(r) => r,
        Err(e) => TurnResult {
            server: config.server,
            reachable: false,
            response_ms: None,
            allocated_address: None,
            success: false,
            error: Some(e),
        },
    }
}

fn turn_allocate_test(server: &str, port: u16) -> Result<TurnResult, String> {
    let addr_str = format!("{}:{}", server, port);
    let dest: SocketAddr = addr_str
        .parse()
        .or_else(|_| {
            addr_str
                .to_socket_addrs()
                .map_err(|e| format!("DNS error: {}", e))?
                .next()
                .ok_or_else(|| "No address found".to_string())
        })?;

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Bind error: {}", e))?;
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| format!("Timeout error: {}", e))?;

    // Build TURN Allocate Request (RFC 5766)
    // Message Type: 0x0003 (Allocate Request)
    let mut request = Vec::with_capacity(28);
    // Type: Allocate
    request.extend_from_slice(&0x0003u16.to_be_bytes());
    // Length: 8 (one attribute: REQUESTED-TRANSPORT)
    request.extend_from_slice(&0x0008u16.to_be_bytes());
    // Magic Cookie
    request.extend_from_slice(&0x2112A442u32.to_be_bytes());
    // Transaction ID (12 bytes)
    let txn_id: [u8; 12] = {
        use std::time::SystemTime;
        let seed = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut id = [0u8; 12];
        for (i, byte) in id.iter_mut().enumerate() {
            *byte = ((seed >> (i * 8)) & 0xFF) as u8;
        }
        id
    };
    request.extend_from_slice(&txn_id);

    // REQUESTED-TRANSPORT attribute (0x0019)
    // Length: 4, Value: 17 (UDP)
    request.extend_from_slice(&0x0019u16.to_be_bytes());
    request.extend_from_slice(&0x0004u16.to_be_bytes());
    request.push(17); // UDP protocol
    request.extend_from_slice(&[0, 0, 0]); // RFFU (Reserved)

    let start = Instant::now();
    socket
        .send_to(&request, dest)
        .map_err(|e| format!("Send error: {}", e))?;

    let mut buf = [0u8; 1024];
    match socket.recv_from(&mut buf) {
        Ok((len, _)) => {
            let response_ms = start.elapsed().as_secs_f64() * 1000.0;
            // Any response means the server is reachable
            // Error 401 (Unauthorized) is expected without credentials
            let msg_type = if len >= 2 {
                u16::from_be_bytes([buf[0], buf[1]])
            } else {
                0
            };

            let reachable = msg_type == 0x0103 || msg_type == 0x0113; // Success or Error response

            Ok(TurnResult {
                server: server.to_string(),
                reachable,
                response_ms: Some(response_ms),
                allocated_address: None,
                success: true,
                error: if msg_type == 0x0113 {
                    Some("Server responded with error (likely needs credentials)".into())
                } else {
                    None
                },
            })
        }
        Err(e) => Ok(TurnResult {
            server: server.to_string(),
            reachable: false,
            response_ms: None,
            allocated_address: None,
            success: false,
            error: Some(format!("No response: {}", e)),
        }),
    }
}
