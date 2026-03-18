//! WebSocket frame parser per RFC 6455.
//!
//! Supports:
//! - Parsing WebSocket frames (text, binary, close, ping, pong)
//! - Extracting payload for further protocol analysis (e.g., SIP-over-WS)
//! - Detecting WebSocket handshake headers

use anyhow::Result;

/// WebSocket opcodes per RFC 6455
pub const OPCODE_CONTINUATION: u8 = 0x0;
pub const OPCODE_TEXT: u8 = 0x1;
pub const OPCODE_BINARY: u8 = 0x2;
pub const OPCODE_CLOSE: u8 = 0x8;
pub const OPCODE_PING: u8 = 0x9;
pub const OPCODE_PONG: u8 = 0xA;

/// Parsed WebSocket frame header and payload.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketFrame {
    /// Final fragment flag
    pub fin: bool,
    /// Reserved bits (typically 0)
    pub rsv1: bool,
    pub rsv2: bool,
    pub rsv3: bool,
    /// Opcode (0=continuation, 1=text, 2=binary, 8=close, 9=ping, 10=pong)
    pub opcode: u8,
    /// Human-readable opcode name
    pub opcode_name: String,
    /// Mask flag (client-to-server frames are masked)
    pub masked: bool,
    /// Payload length
    pub payload_length: u64,
    /// Masking key (4 bytes, if masked)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mask_key: Option<[u8; 4]>,
    /// Unmasked payload data
    pub payload: Vec<u8>,
    /// Total header size in bytes (used for calculating offsets)
    pub header_size: usize,
}

impl WebSocketFrame {
    /// Check if payload appears to be SIP (starts with SIP method or response)
    pub fn is_sip_payload(&self) -> bool {
        if self.payload.is_empty() {
            return false;
        }
        let text = match std::str::from_utf8(&self.payload) {
            Ok(s) => s,
            Err(_) => return false,
        };
        // Check for common SIP methods or response codes
        let trimmed = text.trim_start();
        trimmed.starts_with("INVITE ")
            || trimmed.starts_with("REGISTER ")
            || trimmed.starts_with("ACK ")
            || trimmed.starts_with("BYE ")
            || trimmed.starts_with("CANCEL ")
            || trimmed.starts_with("OPTIONS ")
            || trimmed.starts_with("PRACK ")
            || trimmed.starts_with("SUBSCRIBE ")
            || trimmed.starts_with("NOTIFY ")
            || trimmed.starts_with("PUBLISH ")
            || trimmed.starts_with("INFO ")
            || trimmed.starts_with("REFER ")
            || trimmed.starts_with("MESSAGE ")
            || trimmed.starts_with("UPDATE ")
            || trimmed.starts_with("SIP/2.0 ")
    }
}

fn opcode_name(opcode: u8) -> &'static str {
    match opcode {
        OPCODE_CONTINUATION => "Continuation",
        OPCODE_TEXT => "Text",
        OPCODE_BINARY => "Binary",
        OPCODE_CLOSE => "Close",
        OPCODE_PING => "Ping",
        OPCODE_PONG => "Pong",
        _ => "Unknown",
    }
}

/// Parse a WebSocket frame from raw bytes.
/// Returns the parsed frame if successful.
pub fn parse_websocket_frame(data: &[u8]) -> Result<WebSocketFrame> {
    if data.len() < 2 {
        anyhow::bail!("WebSocket frame too short: {} bytes", data.len());
    }

    let first_byte = data[0];
    let second_byte = data[1];

    // First byte: FIN(1) RSV1(1) RSV2(1) RSV3(1) OPCODE(4)
    let fin = (first_byte & 0x80) != 0;
    let rsv1 = (first_byte & 0x40) != 0;
    let rsv2 = (first_byte & 0x20) != 0;
    let rsv3 = (first_byte & 0x10) != 0;
    let opcode = first_byte & 0x0F;

    // Second byte: MASK(1) PAYLOAD_LEN(7)
    let masked = (second_byte & 0x80) != 0;
    let mut payload_len = (second_byte & 0x7F) as u64;

    let mut offset = 2;

    // Extended payload length
    if payload_len == 126 {
        if data.len() < offset + 2 {
            anyhow::bail!("WebSocket frame truncated (extended 16-bit length)");
        }
        payload_len = u16::from_be_bytes([data[offset], data[offset + 1]]) as u64;
        offset += 2;
    } else if payload_len == 127 {
        if data.len() < offset + 8 {
            anyhow::bail!("WebSocket frame truncated (extended 64-bit length)");
        }
        payload_len = u64::from_be_bytes([
            data[offset], data[offset + 1], data[offset + 2], data[offset + 3],
            data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7],
        ]);
        offset += 8;
    }

    // Masking key (4 bytes if masked)
    let mask_key = if masked {
        if data.len() < offset + 4 {
            anyhow::bail!("WebSocket frame truncated (masking key)");
        }
        let key = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
        offset += 4;
        Some(key)
    } else {
        None
    };

    let header_size = offset;

    // Payload (may be truncated in captured data)
    let available_payload = data.len().saturating_sub(offset);
    let actual_payload_len = std::cmp::min(payload_len as usize, available_payload);
    let mut payload = data[offset..offset + actual_payload_len].to_vec();

    // Unmask payload if masked
    if let Some(key) = mask_key {
        for (i, byte) in payload.iter_mut().enumerate() {
            *byte ^= key[i % 4];
        }
    }

    Ok(WebSocketFrame {
        fin,
        rsv1,
        rsv2,
        rsv3,
        opcode,
        opcode_name: opcode_name(opcode).to_string(),
        masked,
        payload_length: payload_len,
        mask_key,
        payload,
        header_size,
    })
}

/// Check if data looks like a WebSocket frame.
/// Heuristic: valid opcode, reasonable length encoding.
pub fn is_websocket_frame(data: &[u8]) -> bool {
    if data.len() < 2 {
        return false;
    }

    let opcode = data[0] & 0x0F;
    // Valid opcodes: 0-2 (data), 8-10 (control)
    let valid_opcode = matches!(opcode, 0..=2 | 8..=10);
    
    if !valid_opcode {
        return false;
    }

    // Check for reserved bits (should be 0 in standard WS)
    let rsv = (data[0] >> 4) & 0x07;
    if rsv != 0 {
        return false;
    }

    true
}

/// Check if TCP payload looks like a WebSocket HTTP upgrade request.
pub fn is_websocket_upgrade_request(data: &[u8]) -> bool {
    let text = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let lower = text.to_lowercase();
    lower.contains("upgrade: websocket") && lower.contains("connection: upgrade")
}

/// Check if TCP payload looks like a WebSocket HTTP upgrade response.
pub fn is_websocket_upgrade_response(data: &[u8]) -> bool {
    let text = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return false,
    };
    text.starts_with("HTTP/1.1 101") && text.to_lowercase().contains("upgrade: websocket")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_unmasked_text_frame() {
        // Unmasked text frame with "Hello"
        // FIN=1, opcode=1 (text), no mask, len=5
        let frame_data = [
            0x81, // FIN=1, opcode=1
            0x05, // No mask, len=5
            b'H', b'e', b'l', b'l', b'o',
        ];
        let frame = parse_websocket_frame(&frame_data).unwrap();
        assert!(frame.fin);
        assert_eq!(frame.opcode, OPCODE_TEXT);
        assert!(!frame.masked);
        assert_eq!(frame.payload_length, 5);
        assert_eq!(&frame.payload, b"Hello");
    }

    #[test]
    fn test_is_websocket_frame() {
        // Valid text frame start
        assert!(is_websocket_frame(&[0x81, 0x05]));
        // Valid binary frame start
        assert!(is_websocket_frame(&[0x82, 0x10]));
        // Invalid opcode
        assert!(!is_websocket_frame(&[0x8F, 0x05]));
        // Too short
        assert!(!is_websocket_frame(&[0x81]));
    }
}
