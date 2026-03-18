use anyhow::{Context, Result};
use std::fmt;

/// RFC 3261 compliant SIP URI parser
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SipUri {
    pub scheme: String,      // sip or sips
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub parameters: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
}

impl SipUri {
    /// Parse a SIP URI from a string
    /// Supports formats:
    /// - sip:user@host
    /// - sip:user@host:port
    /// - sip:host
    /// - sip:host:port
    /// - sips:user@host:port
    /// - IP addresses (with or without port)
    pub fn parse(uri: &str) -> Result<Self> {
        let uri = uri.trim();
        
        // Remove angle brackets if present
        let uri = uri.strip_prefix('<').unwrap_or(uri);
        let uri = uri.strip_suffix('>').unwrap_or(uri);
        
        // Check if it's a SIP URI (starts with sip: or sips:)
        let (scheme, rest) = if uri.starts_with("sips:") {
            ("sips", &uri[5..])
        } else if uri.starts_with("sip:") {
            ("sip", &uri[4..])
        } else {
            // Not a SIP URI, treat as hostname/IP
            let (host, port) = Self::parse_host_port(uri)?;
            return Ok(Self {
                scheme: "sip".to_string(),
                user: None,
                host,
                port,
                parameters: Vec::new(),
                headers: Vec::new(),
            });
        };
        
        // Split on ';' for parameters and '?' for headers
        let (uri_part, params_and_headers) = if let Some(pos) = rest.find(';') {
            (&rest[..pos], Some(&rest[pos..]))
        } else if let Some(pos) = rest.find('?') {
            (&rest[..pos], Some(&rest[pos..]))
        } else {
            (rest, None)
        };
        
        // Parse user@host:port
        let (user, host, port) = if let Some(at_pos) = uri_part.find('@') {
            let user_part = &uri_part[..at_pos];
            let host_part = &uri_part[at_pos + 1..];
            
            // Parse host:port
            let (host, port) = Self::parse_host_port(host_part)?;
            (Some(user_part.to_string()), host, port)
        } else {
            // No user, just host:port
            let (host, port) = Self::parse_host_port(uri_part)?;
            (None, host, port)
        };
        
        // Parse parameters and headers
        let mut parameters = Vec::new();
        let mut headers = Vec::new();
        
        if let Some(rest) = params_and_headers {
            let mut in_headers = false;
            let parts: Vec<&str> = rest.split(';').collect();
            
            for part in parts {
                if part.starts_with('?') {
                    in_headers = true;
                    let header_part = &part[1..];
                    for header in header_part.split('&') {
                        if let Some(eq_pos) = header.find('=') {
                            let name = header[..eq_pos].trim();
                            let value = header[eq_pos + 1..].trim();
                            headers.push((name.to_string(), value.to_string()));
                        }
                    }
                } else if !in_headers {
                    if let Some(eq_pos) = part.find('=') {
                        let name = part[..eq_pos].trim();
                        let value = part[eq_pos + 1..].trim();
                        parameters.push((name.to_string(), value.to_string()));
                    } else if !part.is_empty() {
                        parameters.push((part.trim().to_string(), String::new()));
                    }
                }
            }
        }
        
        Ok(Self {
            scheme: scheme.to_string(),
            user,
            host,
            port,
            parameters,
            headers,
        })
    }
    
    /// Parse host:port from a string
    fn parse_host_port(host_port: &str) -> Result<(String, Option<u16>)> {
        // Check if it's IPv6 [host]:port format
        if host_port.starts_with('[') {
            if let Some(close_bracket) = host_port.find(']') {
                let host = host_port[1..close_bracket].to_string();
                let rest = &host_port[close_bracket + 1..];
                if rest.starts_with(':') {
                    let port = rest[1..].parse::<u16>()
                        .context("Invalid port number")?;
                    return Ok((host, Some(port)));
                }
                return Ok((host, None));
            }
        }
        
        // IPv4 or hostname:port
        if let Some(colon_pos) = host_port.rfind(':') {
            // Check if it's not an IPv6 address (which would have multiple colons)
            if !host_port.contains("::") {
                let host = host_port[..colon_pos].to_string();
                let port = host_port[colon_pos + 1..].parse::<u16>()
                    .context("Invalid port number")?;
                return Ok((host, Some(port)));
            }
        }
        
        Ok((host_port.to_string(), None))
    }
    
    /// Convert to string representation
    #[allow(dead_code)]
    pub fn to_uri_string(&self) -> String {
        format!("{}", self)
    }
}

impl fmt::Display for SipUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:", self.scheme)?;
        
        if let Some(ref user) = self.user {
            write!(f, "{}@", user)?;
        }
        
        write!(f, "{}", self.host)?;
        
        if let Some(port) = self.port {
            write!(f, ":{}", port)?;
        }
        
        for (name, value) in &self.parameters {
            write!(f, ";{}", name)?;
            if !value.is_empty() {
                write!(f, "={}", value)?;
            }
        }
        
        if !self.headers.is_empty() {
            write!(f, "?")?;
            let header_parts: Vec<String> = self.headers
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect();
            write!(f, "{}", header_parts.join("&"))?;
        }
        
        Ok(())
    }
}

impl SipUri {
    /// Get the host for DNS resolution
    pub fn host_for_resolution(&self) -> &str {
        &self.host
    }

    /// Get the port, with default based on scheme
    #[allow(dead_code)]
    pub fn port_with_default(&self) -> u16 {
        self.port.unwrap_or_else(|| {
            if self.scheme == "sips" {
                5061
            } else {
                5060
            }
        })
    }
}

/// RFC 3261: escape user part for SIP URI (reserved chars percent-encoded in userinfo)
pub fn escape_user(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '.' | '_' | '!' | '~' | '*' | '\'' | '(' | ')' => out.push(c),
            '&' | '=' | '+' | '$' | ',' | ';' | '?' | '/' => out.push(c), // user-unreserved
            ' ' => out.push_str("%20"),
            '@' | ':' | '%' | '"' | '<' | '>' | '[' | ']' | '#' | '\\' | '^' | '`' | '{' | '}' => {
                for b in c.to_string().as_bytes() {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
            _ => {
                for b in c.to_string().as_bytes() {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    out
}

/// Normalize dial target to RFC 3261 Request-URI and To header.
/// - Phone numbers: normalize to E.164-like (digits only, optional leading +), sip:user@domain.
/// - SIP URIs: parse, escape user, keep host/port.
/// - domain is used as host when target is a number or user-only.
pub fn normalize_dial_target(target: &str, domain_host: &str) -> Result<(String, String), String> {
    let target = target.trim();
    let target = target.strip_prefix("sip:").unwrap_or(target);
    let target = target.strip_prefix("sips:").unwrap_or(target);
    let target = target.trim();

    // E.164 / phone: digits, optional +, allow spaces/dashes/dots/parens for input
    let digits_only: String = target.chars().filter(|c| c.is_ascii_digit()).collect();
    let has_plus = target.starts_with('+');
    let looks_like_number = !digits_only.is_empty()
        && target.chars()
            .all(|c| c.is_ascii_digit() || c == '+' || c == ' ' || c == '-' || c == '.' || c == '(' || c == ')');

    if looks_like_number && !digits_only.is_empty() {
        // Smart E.164 normalization:
        // - Already has +prefix → keep as +digits
        // - 10 digits → assume US/NANP, prepend +1
        // - 11 digits starting with 1 → assume US/NANP with country code, prepend +
        // - >10 digits → assume international, prepend +
        // - <10 digits → likely an extension or short code, keep as-is (no +)
        let user = if has_plus {
            format!("+{}", digits_only)
        } else if digits_only.len() == 10 {
            // 10-digit NANP number (e.g. 9732509777 → +19732509777)
            format!("+1{}", digits_only)
        } else if digits_only.len() == 11 && digits_only.starts_with('1') {
            // 11-digit number starting with 1 (e.g. 19732509777 → +19732509777)
            format!("+{}", digits_only)
        } else if digits_only.len() > 10 {
            // International number without + (e.g. 441234567890 → +441234567890)
            format!("+{}", digits_only)
        } else {
            // Short number / extension — keep digits only
            digits_only.clone()
        };
        let user_escaped = escape_user(&user);
        let request_uri = format!("sip:{}@{}", user_escaped, domain_host);
        let to_value = format!("<sip:{}@{}>", user_escaped, domain_host);
        return Ok((request_uri, to_value));
    }

    // Full SIP URI: user@host or user@host:port
    if let Some(at_pos) = target.find('@') {
        let user_part = target[..at_pos].trim();
        let host_part = target[at_pos + 1..].trim();
        if host_part.is_empty() {
            return Err("Invalid SIP URI: missing host after @".to_string());
        }
        let (host, port_suffix) = if let Some(close) = host_part.find(']') {
            if host_part.starts_with('[') {
                let host = host_part[..=close].to_string();
                let rest = host_part[close + 1..].trim_start_matches(':');
                let port = if rest.is_empty() { String::new() } else { format!(":{}", rest) };
                (host, port)
            } else {
                let (h, p) = parse_host_port_simple(host_part);
                (h, p)
            }
        } else {
            let (h, p) = parse_host_port_simple(host_part);
            (h, p)
        };
        let user_escaped = escape_user(user_part);
        let request_uri = format!("sip:{}@{}{}", user_escaped, host, port_suffix);
        let to_value = format!("<sip:{}@{}{}>", user_escaped, host, port_suffix);
        return Ok((request_uri, to_value));
    }

    // Bare user at domain: use provided domain
    if target.is_empty() {
        return Err("Empty dial target".to_string());
    }
    let user_escaped = escape_user(target);
    let request_uri = format!("sip:{}@{}", user_escaped, domain_host);
    let to_value = format!("<sip:{}@{}>", user_escaped, domain_host);
    Ok((request_uri, to_value))
}

fn parse_host_port_simple(host_port: &str) -> (String, String) {
    let host_port = host_port.trim();
    if host_port.starts_with('[') {
        if let Some(close) = host_port.find(']') {
            let host = host_port[..=close].to_string();
            let rest = host_port[close + 1..].trim_start_matches(':');
            let port = if rest.is_empty() { String::new() } else { format!(":{}", rest) };
            return (host, port);
        }
    }
    if let Some(colon_pos) = host_port.rfind(':') {
        if !host_port[..colon_pos].contains(']') {
            let host = host_port[..colon_pos].to_string();
            let port = format!(":{}", host_port[colon_pos + 1..].trim());
            return (host, port);
        }
    }
    (host_port.to_string(), String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_e164() {
        let (req, to) = normalize_dial_target("+15551234567", "sip.example.com").unwrap();
        assert_eq!(req, "sip:+15551234567@sip.example.com");
        assert_eq!(to, "<sip:+15551234567@sip.example.com>");
        // 10-digit US number → auto-prepend +1
        let (req2, _) = normalize_dial_target("555 123 4567", "pbx.local").unwrap();
        assert_eq!(req2, "sip:+15551234567@pbx.local");
        // 11-digit starting with 1 → treat as US with country code
        let (req3, _) = normalize_dial_target("19732509777", "sip.example.com").unwrap();
        assert_eq!(req3, "sip:+19732509777@sip.example.com");
    }

    #[test]
    fn test_normalize_sip_uri() {
        let (req, to) = normalize_dial_target("user@host.com", "ignored.local").unwrap();
        assert_eq!(req, "sip:user@host.com");
        assert_eq!(to, "<sip:user@host.com>");
        let (req2, _) = normalize_dial_target("sip:alice@atlanta.com:5060", "x").unwrap();
        assert_eq!(req2, "sip:alice@atlanta.com:5060");
    }

    #[test]
    fn test_escape_user() {
        assert_eq!(escape_user("alice"), "alice");
        assert_eq!(escape_user("+1555"), "+1555");
        assert_eq!(escape_user("user@name"), "user%40name");
    }

    #[test]
    fn test_parse_simple_host() {
        let uri = SipUri::parse("example.com").unwrap();
        assert_eq!(uri.host, "example.com");
        assert_eq!(uri.port, None);
        assert_eq!(uri.user, None);
    }
    
    #[test]
    fn test_parse_sip_user_host() {
        let uri = SipUri::parse("sip:user@example.com").unwrap();
        assert_eq!(uri.scheme, "sip");
        assert_eq!(uri.user, Some("user".to_string()));
        assert_eq!(uri.host, "example.com");
        assert_eq!(uri.port, None);
    }
    
    #[test]
    fn test_parse_sip_host_port() {
        let uri = SipUri::parse("sip:example.com:5060").unwrap();
        assert_eq!(uri.scheme, "sip");
        assert_eq!(uri.host, "example.com");
        assert_eq!(uri.port, Some(5060));
    }
    
    #[test]
    fn test_parse_sip_user_host_port() {
        let uri = SipUri::parse("sip:user@example.com:5060").unwrap();
        assert_eq!(uri.scheme, "sip");
        assert_eq!(uri.user, Some("user".to_string()));
        assert_eq!(uri.host, "example.com");
        assert_eq!(uri.port, Some(5060));
    }
    
    #[test]
    fn test_parse_with_angle_brackets() {
        let uri = SipUri::parse("<sip:user@example.com>").unwrap();
        assert_eq!(uri.user, Some("user".to_string()));
        assert_eq!(uri.host, "example.com");
    }
    
    #[test]
    fn test_parse_ip_address() {
        let uri = SipUri::parse("192.168.1.1").unwrap();
        assert_eq!(uri.host, "192.168.1.1");
    }
    
    #[test]
    fn test_parse_ip_address_port() {
        let uri = SipUri::parse("192.168.1.1:5060").unwrap();
        assert_eq!(uri.host, "192.168.1.1");
        assert_eq!(uri.port, Some(5060));
    }
}
