//! RFC 3261 compliant SIP message construction and parsing.
//! - Request/response: CRLF line endings, Content-Length when body present.
//! - Header names: case-insensitive per RFC; we emit and store canonical form.

use anyhow::{Context, Result};
use std::collections::HashMap;
use uuid::Uuid;

/// RFC 3261: capitalize first letter of each token (e.g. content-type -> Content-Type).
fn canonical_header_name(name: &str) -> String {
    name.split('-')
        .map(|s| {
            let mut c = s.chars();
            match c.next() {
                None => String::new(),
                Some(first) => {
                    let rest: String = c.flat_map(|ch| ch.to_lowercase()).collect();
                    first.to_uppercase().to_string() + &rest
                }
            }
        })
        .collect::<Vec<_>>()
        .join("-")
}

#[derive(Debug, Clone)]
pub struct SipMessage {
    pub method: String,
    pub uri: String,
    pub version: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub status_code: Option<u16>,
    pub status_text: Option<String>,
}

impl SipMessage {
    pub fn new_request(method: &str, uri: &str) -> Self {
        Self {
            method: method.to_string(),
            uri: uri.to_string(),
            version: "SIP/2.0".to_string(),
            headers: HashMap::new(),
            body: None,
            status_code: None,
            status_text: None,
        }
    }

    #[allow(dead_code)]
    pub fn new_response(status_code: u16, status_text: &str) -> Self {
        Self {
            method: String::new(),
            uri: String::new(),
            version: "SIP/2.0".to_string(),
            headers: HashMap::new(),
            body: None,
            status_code: Some(status_code),
            status_text: Some(status_text.to_string()),
        }
    }

    /// Set header, overwriting any previous value (canonical form per RFC 3261).
    pub fn add_header(&mut self, name: &str, value: &str) {
        let canonical = canonical_header_name(name);
        self.headers.insert(canonical, value.to_string());
    }

    /// Alias for `add_header` — overwrites any existing value.
    #[allow(dead_code)]
    pub fn set_header(&mut self, name: &str, value: &str) {
        self.add_header(name, value);
    }

    /// Append a header value with comma-separation (RFC 3261 §7.3.1).
    /// If the header doesn't exist yet, inserts it; otherwise appends ", <value>".
    #[allow(dead_code)]
    pub fn append_header(&mut self, name: &str, value: &str) {
        let canonical = canonical_header_name(name);
        match self.headers.entry(canonical) {
            std::collections::hash_map::Entry::Occupied(mut e) => {
                e.get_mut().push_str(", ");
                e.get_mut().push_str(value);
            }
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(value.to_string());
            }
        }
    }

    /// Get header by name (case-insensitive per RFC 3261).
    /// Also checks SIP compact header forms (RFC 3261 §7.3.3).
    pub fn get_header(&self, name: &str) -> Option<&String> {
        let canonical = canonical_header_name(name);
        self.headers.get(&canonical).or_else(|| {
            // Try compact form equivalents (RFC 3261 §7.3.3)
            let compact = match canonical.as_str() {
                "Call-Id" => Some("I"),
                "Contact" => Some("M"),
                "Content-Encoding" => Some("E"),
                "Content-Length" => Some("L"),
                "Content-Type" => Some("C"),
                "From" => Some("F"),
                "Subject" => Some("S"),
                "Supported" => Some("K"),
                "To" => Some("T"),
                "Via" => Some("V"),
                // Reverse: if searching by compact form, try full name
                "I" => Some("Call-Id"),
                "M" => Some("Contact"),
                "E" => Some("Content-Encoding"),
                "L" => Some("Content-Length"),
                "C" => Some("Content-Type"),
                "F" => Some("From"),
                "S" => Some("Subject"),
                "K" => Some("Supported"),
                "T" => Some("To"),
                "V" => Some("Via"),
                _ => None,
            };
            compact.and_then(|alt| self.headers.get(alt))
        })
    }

    /// Serialize to wire format: CRLF line endings, Content-Length when body present (RFC 3261 §20.14).
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut message = String::new();

        // Start line (RFC 3261 §7.1): Method SP Request-URI SP SIP-Version CRLF or SIP-Version SP Status-Code SP Reason-Phrase CRLF
        if let Some(code) = self.status_code {
            message.push_str(&format!(
                "{} {} {}\r\n",
                self.version,
                code,
                self.status_text.as_deref().unwrap_or("")
            ));
        } else {
            message.push_str(&format!(
                "{} {} {}\r\n",
                self.method, self.uri, self.version
            ));
        }

        // RFC 3261 §20.14: Content-Length MUST be present when message has a body.
        // Use a single body reference for both length and content so body is never omitted.
        let body_str: &str = self.body.as_deref().unwrap_or("");
        let content_length = body_str.len();

        // Headers: name: value CRLF (emit our Content-Length so it's correct; skip duplicate from map)
        for (name, value) in &self.headers {
            if name.eq_ignore_ascii_case("Content-Length") {
                continue;
            }
            message.push_str(&format!("{}: {}\r\n", name, value));
        }
        message.push_str(&format!("Content-Length: {}\r\n", content_length));

        // Empty line (CRLF) marks end of headers
        message.push_str("\r\n");

        // Body (octet count must match Content-Length)
        message.push_str(body_str);

        Ok(message.into_bytes())
    }

    /// Parse SIP message (RFC 3261): CRLF line endings, optional header folding, Content-Length for body.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        let text = String::from_utf8(data.to_vec()).context("Invalid UTF-8 in SIP message")?;
        let lines: Vec<&str> = text.lines().map(|l| l.trim_end_matches('\r')).collect();
        if lines.is_empty() {
            anyhow::bail!("Empty SIP message");
        }

        let start_line = lines[0];
        let parts: Vec<&str> = start_line.split_whitespace().collect();
        if parts.len() < 3 {
            anyhow::bail!("Invalid SIP start line");
        }

        let (method, uri, version, status_code, status_text) = if parts[0].starts_with("SIP/") {
            let code: u16 = parts[1].parse().context("Invalid status code")?;
            let reason = parts[2..].join(" ");
            (
                String::new(),
                String::new(),
                parts[0].to_string(),
                Some(code),
                Some(reason),
            )
        } else {
            (
                parts[0].to_string(),
                parts[1].to_string(),
                parts[2].to_string(),
                None,
                None,
            )
        };

        let mut headers: HashMap<String, String> = HashMap::new();
        let mut current_header: Option<(String, String)> = None;

        for line in lines.iter().skip(1) {
            if line.is_empty() {
                if let Some((name, value)) = current_header.take() {
                    let canonical = canonical_header_name(&name);
                    match headers.entry(canonical) {
                        std::collections::hash_map::Entry::Occupied(mut e) => {
                            e.get_mut().push_str(", ");
                            e.get_mut().push_str(&value);
                        }
                        std::collections::hash_map::Entry::Vacant(e) => {
                            e.insert(value);
                        }
                    }
                }
                break;
            }
            // RFC 3261 §7.3.1: line starting with LWS (SP/HTAB) is continuation of previous header
            if line.starts_with(' ') || line.starts_with('\t') {
                if let Some((ref _name, ref mut value)) = current_header {
                    value.push(' ');
                    value.push_str(line.trim());
                }
                continue;
            }
            if let Some((name, value)) = current_header.take() {
                let canonical = canonical_header_name(&name);
                match headers.entry(canonical) {
                    std::collections::hash_map::Entry::Occupied(mut e) => {
                        e.get_mut().push_str(", ");
                        e.get_mut().push_str(&value);
                    }
                    std::collections::hash_map::Entry::Vacant(e) => {
                        e.insert(value);
                    }
                }
            }
            if let Some(colon_pos) = line.find(':') {
                let name = line[..colon_pos].trim().to_string();
                let value = line[colon_pos + 1..].trim().to_string();
                current_header = Some((name, value));
            }
        }
        if let Some((name, value)) = current_header.take() {
            let canonical = canonical_header_name(&name);
            match headers.entry(canonical) {
                std::collections::hash_map::Entry::Occupied(mut e) => {
                    e.get_mut().push_str(", ");
                    e.get_mut().push_str(&value);
                }
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(value);
                }
            }
        }

        // RFC 3261: body starts after first empty line; length from Content-Length if present
        let body = {
            let sep = b"\r\n\r\n";
            let sep_alt = b"\n\n";
            let pos = data.windows(sep.len()).position(|w| w == sep);
            let pos_alt = data.windows(sep_alt.len()).position(|w| w == sep_alt);
            let body_start = pos
                .map(|p| p + sep.len())
                .or_else(|| pos_alt.map(|p| p + sep_alt.len()));
            if let Some(start) = body_start {
                let content_length = headers
                    .get(&canonical_header_name("Content-Length"))
                    .and_then(|v| v.trim().parse::<usize>().ok());
                let rest = &data[start..];
                let len = content_length.unwrap_or(rest.len()).min(rest.len());
                if len > 0 {
                    Some(
                        String::from_utf8(rest[..len].to_vec())
                            .unwrap_or_else(|_| String::from_utf8_lossy(&rest[..len]).to_string()),
                    )
                } else {
                    None
                }
            } else {
                None
            }
        };

        Ok(Self {
            method,
            uri,
            version,
            headers,
            body,
            status_code,
            status_text,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_to_bytes_includes_sdp_body() {
        let sdp = "v=0\r\no=sipalyzer 0 0 IN IP4 10.0.0.1\r\ns=-\r\nc=IN IP4 10.0.0.1\r\nt=0 0\r\nm=audio 10000 RTP/AVP 0 8 9\r\na=sendrecv\r\na=ptime:20\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:9 G722/8000\r\n";
        let mut req = SipMessage::new_request("INVITE", "sip:test@example.com");
        req.add_header("Via", "SIP/2.0/UDP 10.0.0.1:5060;branch=z9hG4bK1");
        req.add_header("Content-Type", "application/sdp");
        req.body = Some(sdp.to_string());
        let bytes = req.to_bytes().unwrap();
        assert!(
            bytes.windows(7).any(|w| w == b"m=audio"),
            "Serialized INVITE must contain m=audio in body"
        );
        let body_start = bytes
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| p + 4)
            .unwrap_or(0);
        let body = &bytes[body_start..];
        assert!(body.starts_with(b"v=0"), "Body must start with SDP");
    }
}

pub fn generate_call_id() -> String {
    format!("{}@sipalyzer", Uuid::new_v4())
}

pub fn generate_tag() -> String {
    Uuid::new_v4().to_string().chars().take(8).collect()
}
