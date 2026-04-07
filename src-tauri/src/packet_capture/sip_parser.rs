use anyhow::Result;
use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSipMessage {
    pub method: Option<String>,
    pub response_code: Option<u16>,
    pub response_text: Option<String>,
    pub request_uri: Option<String>,
    pub headers: HashMap<String, String>,
    pub body: Option<SipBody>,
    pub call_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cseq: Option<String>,
    pub via: Vec<String>,
    pub contact: Option<String>,
    pub content_type: Option<String>,
    pub content_length: Option<usize>,
    pub raw_message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SipBody {
    pub content_type: String,
    pub content: String,
    pub sdp: Option<ParsedSdp>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ParsedSdp {
    pub version: Option<String>,
    pub origin: Option<String>,
    pub session_name: Option<String>,
    pub connection: Option<String>,
    pub timing: Option<String>,
    pub media: Vec<SdpMedia>,
    pub attributes: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SdpMedia {
    pub media_type: String,
    pub port: Option<u16>,
    /// Number of ports (from `m=audio 49170/2 RTP/AVP ...`); RFC 4566 §5.14. Defaults to 1.
    #[serde(default = "default_port_count")]
    pub port_count: u16,
    pub protocol: Option<String>,
    pub payload_types: Vec<u8>,
    pub attributes: Vec<String>,
    /// Media-level connection data (c= line), if present. RFC 4566 §5.7.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
}

fn default_port_count() -> u16 {
    1
}

pub fn parse_sip_message(data: &[u8]) -> Result<ParsedSipMessage> {
    // First, verify this is actually valid UTF-8 text (SIP is text-based)
    let text = match String::from_utf8(data.to_vec()) {
        Ok(t) => t,
        Err(_) => return Err(anyhow::anyhow!("Not valid UTF-8 text")),
    };

    // Store the raw message for later use
    let raw_message = text.clone();

    let lines: Vec<&str> = text.lines().collect();

    if lines.is_empty() {
        return Err(anyhow::anyhow!("Empty SIP message"));
    }

    // Validate first line - must be a valid SIP request or response
    let first_line = lines[0].trim();
    let first_line_upper = first_line.to_uppercase();

    // Must start with SIP method or "SIP/2.0"
    let is_valid_sip_start = first_line_upper.starts_with("REGISTER ")
        || first_line_upper.starts_with("INVITE ")
        || first_line_upper.starts_with("ACK ")
        || first_line_upper.starts_with("BYE ")
        || first_line_upper.starts_with("CANCEL ")
        || first_line_upper.starts_with("OPTIONS ")
        || first_line_upper.starts_with("PRACK ")
        || first_line_upper.starts_with("UPDATE ")
        || first_line_upper.starts_with("INFO ")
        || first_line_upper.starts_with("REFER ")
        || first_line_upper.starts_with("NOTIFY ")
        || first_line_upper.starts_with("SUBSCRIBE ")
        || first_line_upper.starts_with("PUBLISH ")
        || first_line_upper.starts_with("MESSAGE ")
        || first_line_upper.starts_with("SIP/2.0");

    if !is_valid_sip_start {
        return Err(anyhow::anyhow!("Not a valid SIP message"));
    }

    let mut message = ParsedSipMessage {
        method: None,
        response_code: None,
        response_text: None,
        request_uri: None,
        headers: HashMap::new(),
        body: None,
        call_id: None,
        from: None,
        to: None,
        cseq: None,
        via: Vec::new(),
        contact: None,
        content_type: None,
        content_length: None,
        raw_message: raw_message.clone(),
    };

    // Parse first line (request line or status line)
    let first_line = lines[0].trim();
    if first_line.starts_with("SIP/2.0") {
        // Response (e.g., "SIP/2.0 200 OK")
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            message.response_code = parts[1].parse::<u16>().ok();
            if parts.len() >= 3 {
                message.response_text = Some(parts[2..].join(" "));
            } else {
                // Some responses might not have text, use default
                message.response_text = Some("".to_string());
            }
        }
    } else {
        // Request (e.g., "ACK sip:user@example.com SIP/2.0")
        // RFC 3261 §7.1: Request-Line = Method SP Request-URI SP SIP-Version CRLF
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 3 {
            // RFC 3261 §25: Method is case-sensitive — store as-is from wire
            message.method = Some(parts[0].to_string());
            message.request_uri = Some(parts[1].to_string());
            // parts[2] is SIP-Version (e.g. "SIP/2.0")
        } else if parts.len() >= 1 {
            // Lenient fallback for malformed requests (fewer than 3 parts)
            message.method = Some(parts[0].to_string());
            if parts.len() >= 2 {
                message.request_uri = Some(parts[1].to_string());
            }
        }
    }

    // Parse headers (RFC 3261: continuation lines start with space or tab)
    let mut body_start = lines.len();
    let mut last_header_name: Option<String> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        let trimmed = line.trim();

        // Empty line indicates start of body
        if trimmed.is_empty() {
            body_start = i + 1;
            break;
        }

        // Handle continuation lines (start with space or tab) — append to previous header value
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(ref name) = last_header_name {
                let appended = format!(" {}", trimmed);
                if let Some(prev) = message.headers.get_mut(name) {
                    prev.push_str(&appended);
                }
                // Header names are already normalized to lowercase
                match name.as_str() {
                    "call-id" | "i" => {
                        if let Some(ref mut v) = message.call_id {
                            v.push_str(&appended);
                        }
                    }
                    "from" | "f" => {
                        if let Some(ref mut v) = message.from {
                            v.push_str(&appended);
                        }
                    }
                    "to" | "t" => {
                        if let Some(ref mut v) = message.to {
                            v.push_str(&appended);
                        }
                    }
                    "cseq" => {
                        if let Some(ref mut v) = message.cseq {
                            v.push_str(&appended);
                        }
                    }
                    "via" | "v" => {
                        if let Some(last) = message.via.last_mut() {
                            last.push_str(&appended);
                        }
                    }
                    "contact" | "m" => {
                        if let Some(ref mut v) = message.contact {
                            v.push_str(&appended);
                        }
                    }
                    "content-type" | "c" => {
                        if let Some(ref mut v) = message.content_type {
                            v.push_str(&appended);
                        }
                    }
                    "content-length" | "l" => {
                        // Append to headers map; we re-parse content_length after the loop
                        if let Some(prev) = message.headers.get_mut(name) {
                            prev.push_str(&appended);
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }

        // Parse new header
        // RFC 3261 §7.3.1: Header field names are case-insensitive.
        // Normalize to lowercase for consistent storage and lookup.
        if let Some(colon_pos) = trimmed.find(':') {
            let header_name = trimmed[..colon_pos].trim().to_lowercase();
            let header_value = trimmed[colon_pos + 1..].trim().to_string();
            last_header_name = Some(header_name.clone());

            message
                .headers
                .insert(header_name.clone(), header_value.clone());

            match header_name.as_str() {
                "call-id" | "i" => {
                    message.call_id = Some(header_value);
                }
                "from" | "f" => {
                    message.from = Some(header_value);
                }
                "to" | "t" => {
                    message.to = Some(header_value);
                }
                "cseq" => {
                    message.cseq = Some(header_value);
                }
                "via" | "v" => {
                    message.via.push(header_value);
                }
                "contact" | "m" => {
                    message.contact = Some(header_value);
                }
                "content-type" | "c" => {
                    message.content_type = Some(header_value);
                }
                "content-length" | "l" => {
                    message.content_length = header_value.parse::<usize>().ok();
                }
                _ => {}
            }
        } else {
            last_header_name = None;
        }
    }

    // Re-parse content_length from headers (handles continuation lines).
    // Header names are now normalized to lowercase; also check compact form "l".
    let cl = message
        .headers
        .get("content-length")
        .or_else(|| message.headers.get("l"));
    if let Some(s) = cl {
        message.content_length = s
            .trim()
            .split_whitespace()
            .next()
            .and_then(|n| n.parse::<usize>().ok());
    }

    // Parse body per RFC 3261: body starts after \r\n\r\n (or \n\n), length from Content-Length.
    let content_type = message.content_type.clone().unwrap_or_default();
    let body_text = {
        let sep = b"\r\n\r\n";
        let sep_alt = b"\n\n";
        let body_start_byte = data
            .windows(sep.len())
            .position(|w| w == sep)
            .map(|p| p + sep.len())
            .or_else(|| {
                data.windows(sep_alt.len())
                    .position(|w| w == sep_alt)
                    .map(|p| p + sep_alt.len())
            });
        if let Some(start) = body_start_byte {
            let content_length = message.content_length.unwrap_or(0);
            let rest = &data[start..];
            let len = if content_length > 0 {
                content_length.min(rest.len())
            } else {
                rest.len()
            };
            if len > 0 {
                String::from_utf8(rest[..len].to_vec())
                    .unwrap_or_else(|_| String::from_utf8_lossy(&rest[..len]).to_string())
            } else {
                String::new()
            }
        } else if body_start < lines.len() {
            lines[body_start..].join("\n")
        } else {
            String::new()
        }
    };

    if !body_text.is_empty() || message.content_length.map(|n| n > 0).unwrap_or(false) {
        let mut sip_body = SipBody {
            content_type: content_type.clone(),
            content: body_text.clone(),
            sdp: None,
        };
        if content_type.to_lowercase().contains("application/sdp") {
            sip_body.sdp = parse_sdp(&body_text).ok();
        }
        message.body = Some(sip_body);
    }

    Ok(message)
}

fn parse_sdp(sdp_text: &str) -> Result<ParsedSdp> {
    let lines: Vec<&str> = sdp_text.lines().collect();

    let mut sdp = ParsedSdp {
        version: None,
        origin: None,
        session_name: None,
        connection: None,
        timing: None,
        media: Vec::new(),
        attributes: Vec::new(),
    };

    let mut current_media: Option<SdpMedia> = None;

    for line in lines {
        let line = line.trim();
        if line.is_empty() || line.len() < 2 {
            continue;
        }

        let key = &line[..1];
        let value = if line.len() > 2 { &line[2..] } else { "" };

        match key {
            "v" => sdp.version = Some(value.to_string()),
            "o" => sdp.origin = Some(value.to_string()),
            "s" => sdp.session_name = Some(value.to_string()),
            "c" => {
                // RFC 4566 §5.7: Connection data at media level overrides session level.
                if let Some(ref mut media) = current_media {
                    media.connection = Some(value.to_string());
                } else {
                    sdp.connection = Some(value.to_string());
                }
            }
            "t" => sdp.timing = Some(value.to_string()),
            "b" => {
                // RFC 4566 §5.8: Bandwidth — store as attribute for now
                if let Some(ref mut media) = current_media {
                    media.attributes.push(format!("b={}", value));
                }
                // Session-level bandwidth is noted but not currently stored
            }
            "m" => {
                // Save previous media if exists
                if let Some(media) = current_media.take() {
                    sdp.media.push(media);
                }

                // Parse media line: m=<media> <port>[/<number>] <proto> <fmt> ...
                // RFC 4566 §5.14: port/number-of-ports
                let parts: Vec<&str> = value.split_whitespace().collect();
                if parts.len() >= 3 {
                    let port_parts: Vec<&str> = parts[1].splitn(2, '/').collect();
                    let port = port_parts[0].parse::<u16>().ok();
                    let port_count = port_parts
                        .get(1)
                        .and_then(|s| s.parse::<u16>().ok())
                        .unwrap_or(1);
                    let payload_types: Vec<u8> = parts[3..]
                        .iter()
                        .filter_map(|s| s.parse::<u8>().ok())
                        .collect();

                    current_media = Some(SdpMedia {
                        media_type: parts[0].to_string(),
                        port,
                        port_count,
                        protocol: Some(parts[2].to_string()),
                        payload_types,
                        attributes: Vec::new(),
                        connection: None,
                    });
                }
            }
            "a" => {
                if let Some(ref mut media) = current_media {
                    media.attributes.push(value.to_string());
                } else {
                    sdp.attributes.push(value.to_string());
                }
            }
            _ => {
                // Other SDP fields (i=, u=, e=, p=, k=, z=, etc.)
                // These are informational; don't mix them into the attributes list
                // to avoid confusion with actual a= attributes.
            }
        }
    }

    // Add last media if exists
    if let Some(media) = current_media {
        sdp.media.push(media);
    }

    Ok(sdp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sip_register() {
        let sip_data = b"REGISTER sip:example.com SIP/2.0\r\n\
            Via: SIP/2.0/UDP 192.168.1.1:5060;branch=z9hG4bK1234\r\n\
            From: <sip:user@example.com>;tag=abc123\r\n\
            To: <sip:user@example.com>\r\n\
            Call-ID: test-call-id@192.168.1.1\r\n\
            CSeq: 1 REGISTER\r\n\
            Contact: <sip:user@192.168.1.1:5060>\r\n\
            Content-Length: 0\r\n\r\n";

        let parsed = parse_sip_message(sip_data).unwrap();
        assert_eq!(parsed.method, Some("REGISTER".to_string()));
        assert_eq!(parsed.request_uri, Some("sip:example.com".to_string()));
        assert!(parsed.call_id.is_some());
        assert!(parsed.from.is_some());
    }

    #[test]
    fn test_parse_sip_response() {
        let sip_data = b"SIP/2.0 200 OK\r\n\
            Via: SIP/2.0/UDP 192.168.1.1:5060;branch=z9hG4bK1234\r\n\
            From: <sip:user@example.com>;tag=abc123\r\n\
            To: <sip:user@example.com>;tag=xyz789\r\n\
            Call-ID: test-call-id@192.168.1.1\r\n\
            CSeq: 1 REGISTER\r\n\
            Content-Length: 0\r\n\r\n";

        let parsed = parse_sip_message(sip_data).unwrap();
        assert_eq!(parsed.response_code, Some(200));
        assert_eq!(parsed.response_text, Some("OK".to_string()));
    }
}
