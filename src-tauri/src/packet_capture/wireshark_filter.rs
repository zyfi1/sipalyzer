use anyhow::Result;
use std::net::IpAddr;
use ipnetwork::IpNetwork;
use crate::packet_capture::ApplicationLayer;

// ─── AST ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct WiresharkFilter {
    pub conditions: Vec<FilterCondition>,
}

#[derive(Debug, Clone)]
pub enum FilterCondition {
    /// Protocol existence check: `sip`, `rtp`, `udp`, `tcp`, `ip`, `dns`, etc.
    Protocol(String),
    /// IP address comparison: `ip.addr == 1.2.3.4`, `ip.src != 10.0.0.0/8`
    IpAddr { field: IpField, operator: Operator, value: String },
    /// Port comparison: `udp.port == 5060`, `tcp.dstport > 1024`
    Port { field: PortField, operator: Operator, value: u16 },
    /// Generic field comparison: `sip.method == "INVITE"`, `frame.len > 500`
    Field { field: String, operator: Operator, value: FilterValue },
    /// Logical combination: `&&`, `||`
    Logical { op: LogicalOp, left: Box<FilterCondition>, right: Box<FilterCondition> },
    /// Negation: `!sip`, `not (ip.addr == 1.2.3.4)`
    Not(Box<FilterCondition>),
    /// Set membership: `tcp.port in {80, 443, 8080}`, `ip.addr in {1.2.3.4, 5.6.7.8}`
    InSet { field: String, values: Vec<FilterValue> },
    /// Regex match: `sip.Method ~ "INVITE|REGISTER"`, `frame ~ "pattern"`
    Matches { field: String, pattern: String },
    /// Frame/payload text search: `frame contains "SIP/2.0"`
    FrameContains(String),
    /// Field existence check: bare `sip.method`, `tcp.port`, etc. — true if the field has a value
    FieldExists(String),
    /// Bitwise AND check: `tcp.flags & 0x02` — true if result is non-zero
    BitwiseAnd { field: String, mask: i64 },
}

#[derive(Debug, Clone)]
pub enum IpField {
    Addr,  // ip.addr (matches src or dst)
    Src,   // ip.src
    Dst,   // ip.dst
}

#[derive(Debug, Clone)]
pub enum PortField {
    Port,     // udp.port or tcp.port (matches src or dst)
    SrcPort,  // udp.srcport or tcp.srcport
    DstPort,  // udp.dstport or tcp.dstport
}

#[derive(Debug, Clone, PartialEq)]
pub enum Operator {
    Equals,
    NotEquals,
    GreaterThan,
    LessThan,
    GreaterEqual,
    LessEqual,
    Contains,
    Matches,
}

#[derive(Debug, Clone)]
pub enum LogicalOp {
    And,
    Or,
    Xor,
}

#[derive(Debug, Clone)]
pub enum FilterValue {
    String(String),
    Number(i64),
    Ip(IpAddr),
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Token {
    Identifier(String),
    QuotedString(String),
    Number(i64),
    Equals,       // == or eq
    NotEquals,    // != or ne
    GreaterThan,  // > or gt
    LessThan,     // < or lt
    GreaterEqual, // >= or ge
    LessEqual,    // <= or le
    Contains,     // contains
    Matches,      // matches or ~
    In,           // in
    And,          // && or and
    Or,           // || or or
    Xor,          // ^^ or xor
    Not,          // ! or not
    LeftParen,    // (
    RightParen,   // )
    LeftBrace,    // {
    RightBrace,   // }
    Comma,        // ,
    DotDot,       // ..  (range in set)
    BitwiseAnd,   // & (bitwise AND for flag checks)
}

// ─── Parser ─────────────────────────────────────────────────────────────────

impl WiresharkFilter {
    pub fn parse(filter_str: &str) -> Result<Self> {
        let trimmed = filter_str.trim();
        if trimmed.is_empty() {
            return Ok(Self { conditions: vec![] });
        }

        let tokens = Self::tokenize(trimmed)?;
        if tokens.is_empty() {
            return Ok(Self { conditions: vec![] });
        }

        let (condition, pos) = Self::parse_expression(&tokens, 0)?;
        
        // All tokens should be consumed; if not, report a useful error
        if pos < tokens.len() {
            // Skip stray right-parens (graceful recovery)
            let mut check_pos = pos;
            while check_pos < tokens.len() && matches!(tokens[check_pos], Token::RightParen) {
                check_pos += 1;
            }
            if check_pos < tokens.len() {
                return Err(anyhow::anyhow!("Unexpected token at position {}: {:?}", check_pos, tokens[check_pos]));
            }
        }

        Ok(Self { conditions: vec![condition] })
    }

    // ── Tokenizer ───────────────────────────────────────────────────────────

    fn tokenize(input: &str) -> Result<Vec<Token>> {
        let mut tokens = Vec::new();
        let chars: Vec<char> = input.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            let ch = chars[i];

            // Skip whitespace
            if ch.is_whitespace() {
                i += 1;
                continue;
            }

            // Quoted string: "..." or '...'
            if ch == '"' || ch == '\'' {
                let quote = ch;
                i += 1;
                let mut s = String::new();
                while i < len && chars[i] != quote {
                    if chars[i] == '\\' && i + 1 < len {
                        i += 1;
                        match chars[i] {
                            'n' => s.push('\n'),
                            't' => s.push('\t'),
                            'r' => s.push('\r'),
                            '"' => s.push('"'),
                            '\'' => s.push('\''),
                            '\\' => s.push('\\'),
                            other => { s.push('\\'); s.push(other); }
                        }
                    } else {
                        s.push(chars[i]);
                    }
                    i += 1;
                }
                if i < len { i += 1; } // skip closing quote
                tokens.push(Token::QuotedString(s));
                continue;
            }

            // Two-character operators
            if i + 1 < len {
                let two = format!("{}{}", chars[i], chars[i + 1]);
                match two.as_str() {
                    "==" => { tokens.push(Token::Equals); i += 2; continue; }
                    "!=" => { tokens.push(Token::NotEquals); i += 2; continue; }
                    ">=" => { tokens.push(Token::GreaterEqual); i += 2; continue; }
                    "<=" => { tokens.push(Token::LessEqual); i += 2; continue; }
                    "&&" => { tokens.push(Token::And); i += 2; continue; }
                    "||" => { tokens.push(Token::Or); i += 2; continue; }
                    "^^" => { tokens.push(Token::Xor); i += 2; continue; }
                    ".." => { tokens.push(Token::DotDot); i += 2; continue; }
                    _ => {}
                }
            }

            // Single-character operators/symbols
            match ch {
                '>' => { tokens.push(Token::GreaterThan); i += 1; continue; }
                '<' => { tokens.push(Token::LessThan); i += 1; continue; }
                '!' => { tokens.push(Token::Not); i += 1; continue; }
                '~' => { tokens.push(Token::Matches); i += 1; continue; }
                '(' => { tokens.push(Token::LeftParen); i += 1; continue; }
                ')' => { tokens.push(Token::RightParen); i += 1; continue; }
                '{' => { tokens.push(Token::LeftBrace); i += 1; continue; }
                '}' => { tokens.push(Token::RightBrace); i += 1; continue; }
                ',' => { tokens.push(Token::Comma); i += 1; continue; }
                // Single & is bitwise AND (used for tcp.flags & 0x02)
                '&' => { tokens.push(Token::BitwiseAnd); i += 1; continue; }
                // Single ^ is bitwise XOR
                '^' => { tokens.push(Token::BitwiseAnd); i += 1; continue; } // reuse — rare
                // Single | is not valid (user probably meant ||)
                '|' => {
                    return Err(anyhow::anyhow!("Single '|' is not a valid operator. Use '||' for logical OR"));
                }
                _ => {}
            }

            // Identifier or number (includes dots for field names, colons for IPv6, slashes for CIDR)
            if ch.is_alphanumeric() || ch == '_' || ch == '.' || ch == ':' || ch == '/' || ch == '-' {
                let start = i;
                while i < len && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.' || chars[i] == ':' || chars[i] == '/' || chars[i] == '-') {
                    i += 1;
                }
                let word = chars[start..i].iter().collect::<String>();
                let word_lower = word.to_lowercase();

                // Check for keywords
                match word_lower.as_str() {
                    "and" => tokens.push(Token::And),
                    "or" => tokens.push(Token::Or),
                    "xor" => tokens.push(Token::Xor),
                    "not" => tokens.push(Token::Not),
                    "eq" => tokens.push(Token::Equals),
                    "ne" => tokens.push(Token::NotEquals),
                    "gt" => tokens.push(Token::GreaterThan),
                    "lt" => tokens.push(Token::LessThan),
                    "ge" => tokens.push(Token::GreaterEqual),
                    "le" => tokens.push(Token::LessEqual),
                    "contains" => tokens.push(Token::Contains),
                    "matches" => tokens.push(Token::Matches),
                    "in" => tokens.push(Token::In),
                    _ => {
                        // Try parsing as number (including hex)
                        if let Some(n) = parse_number(&word) {
                            tokens.push(Token::Number(n));
                        } else {
                            tokens.push(Token::Identifier(word));
                        }
                    }
                }
                continue;
            }

            // Unknown character — skip
            i += 1;
        }

        Ok(tokens)
    }

    // ── Expression Parsing (precedence: NOT > AND > XOR > OR) ──────────────

    fn parse_expression(tokens: &[Token], start: usize) -> Result<(FilterCondition, usize)> {
        let (mut condition, mut pos) = Self::parse_xor_expression(tokens, start)?;

        while pos < tokens.len() {
            if matches!(tokens[pos], Token::Or) {
                pos += 1;
                let (right, new_pos) = Self::parse_xor_expression(tokens, pos)?;
                condition = FilterCondition::Logical {
                    op: LogicalOp::Or,
                    left: Box::new(condition),
                    right: Box::new(right),
                };
                pos = new_pos;
            } else {
                break;
            }
        }

        Ok((condition, pos))
    }

    fn parse_xor_expression(tokens: &[Token], start: usize) -> Result<(FilterCondition, usize)> {
        let (mut condition, mut pos) = Self::parse_and_expression(tokens, start)?;

        while pos < tokens.len() {
            if matches!(tokens[pos], Token::Xor) {
                pos += 1;
                let (right, new_pos) = Self::parse_and_expression(tokens, pos)?;
                condition = FilterCondition::Logical {
                    op: LogicalOp::Xor,
                    left: Box::new(condition),
                    right: Box::new(right),
                };
                pos = new_pos;
            } else {
                break;
            }
        }

        Ok((condition, pos))
    }

    fn parse_and_expression(tokens: &[Token], start: usize) -> Result<(FilterCondition, usize)> {
        let (mut condition, mut pos) = Self::parse_unary_expression(tokens, start)?;

        while pos < tokens.len() {
            if matches!(tokens[pos], Token::And) {
                // Explicit AND: &&, and
                pos += 1;
                let (right, new_pos) = Self::parse_unary_expression(tokens, pos)?;
                condition = FilterCondition::Logical {
                    op: LogicalOp::And,
                    left: Box::new(condition),
                    right: Box::new(right),
                };
                pos = new_pos;
            } else if Self::can_start_primary(&tokens[pos]) {
                // Implicit AND: two conditions side by side without operator
                // e.g. "ip.src == 1.2.3.4 ip.dst == 5.6.7.8" or "sip rtp"
                let (right, new_pos) = Self::parse_unary_expression(tokens, pos)?;
                condition = FilterCondition::Logical {
                    op: LogicalOp::And,
                    left: Box::new(condition),
                    right: Box::new(right),
                };
                pos = new_pos;
            } else {
                break;
            }
        }

        Ok((condition, pos))
    }

    /// Returns true if the token can begin a new primary expression (for implicit AND).
    fn can_start_primary(token: &Token) -> bool {
        matches!(token, Token::Identifier(_) | Token::Not | Token::LeftParen)
    }

    fn parse_unary_expression(tokens: &[Token], start: usize) -> Result<(FilterCondition, usize)> {
        if start >= tokens.len() {
            return Err(anyhow::anyhow!("Unexpected end of expression"));
        }

        match &tokens[start] {
            Token::Not => {
                let (condition, pos) = Self::parse_unary_expression(tokens, start + 1)?;
                Ok((FilterCondition::Not(Box::new(condition)), pos))
            }
            Token::LeftParen => {
                let (condition, pos) = Self::parse_expression(tokens, start + 1)?;
                if pos >= tokens.len() || !matches!(tokens[pos], Token::RightParen) {
                    return Err(anyhow::anyhow!("Expected ')'"));
                }
                Ok((condition, pos + 1))
            }
            _ => Self::parse_primary(tokens, start),
        }
    }

    fn parse_primary(tokens: &[Token], start: usize) -> Result<(FilterCondition, usize)> {
        if start >= tokens.len() {
            return Err(anyhow::anyhow!("Unexpected end of expression"));
        }

        // Must start with an identifier
        let field = match &tokens[start] {
            Token::Identifier(id) => id.clone(),
            Token::Number(n) => {
                // Bare number "1" or "0" (e.g. result of parenthesized expression)
                return Ok((FilterCondition::Protocol(if *n != 0 { "__true__" } else { "__false__" }.to_string()), start + 1));
            }
            _ => return Err(anyhow::anyhow!("Expected field name or protocol, got {:?}", tokens[start])),
        };

        let field_lower = field.to_lowercase();

        // Bare field name at end of input — treat as existence check
        if start + 1 >= tokens.len() {
            if is_protocol_name(&field_lower) {
                return Ok((FilterCondition::Protocol(field_lower), start + 1));
            }
            // Wireshark: bare "ip.src" or "sip.method" means "field exists"
            return Ok((FilterCondition::FieldExists(field_lower), start + 1));
        }

        // Bare field followed by a logical operator or right-paren — existence check
        if !is_operator_token(&tokens[start + 1]) {
            if is_protocol_name(&field_lower) {
                return Ok((FilterCondition::Protocol(field_lower), start + 1));
            }
            return Ok((FilterCondition::FieldExists(field_lower), start + 1));
        }

        // ── "field & mask" (bitwise AND) ─────────────────────────────────────
        if matches!(tokens[start + 1], Token::BitwiseAnd) {
            if start + 2 >= tokens.len() {
                return Err(anyhow::anyhow!("Expected mask value after '&'"));
            }
            let mask = match &tokens[start + 2] {
                Token::Number(n) => *n,
                Token::Identifier(s) => parse_number(s).ok_or_else(|| anyhow::anyhow!("Expected numeric mask after '&', got '{}'", s))?,
                _ => return Err(anyhow::anyhow!("Expected numeric mask after '&'")),
            };
            return Ok((FilterCondition::BitwiseAnd { field: field_lower, mask }, start + 3));
        }

        // ── "field in { ... }" ──────────────────────────────────────────────
        if matches!(tokens[start + 1], Token::In) {
            return Self::parse_in_set(tokens, start, &field);
        }

        // ── "field contains value" ──────────────────────────────────────────
        if matches!(tokens[start + 1], Token::Contains) {
            if start + 2 >= tokens.len() {
                return Err(anyhow::anyhow!("Expected value after 'contains'"));
            }
            let search_str = match &tokens[start + 2] {
                Token::QuotedString(s) => s.clone(),
                Token::Identifier(s) => s.clone(),
                Token::Number(n) => n.to_string(),
                // Accept keyword tokens as string values
                other => token_to_string(other).ok_or_else(|| anyhow::anyhow!("Expected search string after 'contains'"))?,
            };

            // Special case: "frame contains" → FrameContains
            if field_lower == "frame" {
                return Ok((FilterCondition::FrameContains(search_str), start + 3));
            }

            return Ok((FilterCondition::Field {
                field,
                operator: Operator::Contains,
                value: FilterValue::String(search_str),
            }, start + 3));
        }

        // ── "field matches/~ pattern" ───────────────────────────────────────
        if matches!(tokens[start + 1], Token::Matches) {
            if start + 2 >= tokens.len() {
                return Err(anyhow::anyhow!("Expected pattern after 'matches'"));
            }
            let pattern = match &tokens[start + 2] {
                Token::QuotedString(s) => s.clone(),
                Token::Identifier(s) => s.clone(),
                other => token_to_string(other).ok_or_else(|| anyhow::anyhow!("Expected regex pattern"))?,
            };
            return Ok((FilterCondition::Matches { field, pattern }, start + 3));
        }

        // ── Standard comparison: field op value ─────────────────────────────
        let operator = match &tokens[start + 1] {
            Token::Equals => Operator::Equals,
            Token::NotEquals => Operator::NotEquals,
            Token::GreaterThan => Operator::GreaterThan,
            Token::LessThan => Operator::LessThan,
            Token::GreaterEqual => Operator::GreaterEqual,
            Token::LessEqual => Operator::LessEqual,
            _ => return Err(anyhow::anyhow!("Expected operator after '{}', got {:?}", field, tokens[start + 1])),
        };

        if start + 2 >= tokens.len() {
            return Err(anyhow::anyhow!("Expected value after operator"));
        }

        let (value, end_pos) = Self::parse_value(tokens, start + 2)?;

        // Categorize into specific condition types
        let condition = Self::build_comparison(&field, operator, value)?;
        Ok((condition, end_pos))
    }

    fn parse_value(tokens: &[Token], pos: usize) -> Result<(FilterValue, usize)> {
        match &tokens[pos] {
            Token::QuotedString(s) => Ok((FilterValue::String(s.clone()), pos + 1)),
            Token::Number(n) => Ok((FilterValue::Number(*n), pos + 1)),
            Token::Identifier(s) => {
                // Try IP address first
                if let Ok(ip) = s.parse::<IpAddr>() {
                    Ok((FilterValue::Ip(ip), pos + 1))
                } else if s.contains('/') {
                    // CIDR notation — keep as string for IpNetwork parsing
                    Ok((FilterValue::String(s.clone()), pos + 1))
                } else if let Some(n) = parse_number(s) {
                    Ok((FilterValue::Number(n), pos + 1))
                } else {
                    Ok((FilterValue::String(s.clone()), pos + 1))
                }
            }
            // Keyword tokens appearing in value position — treat as string values
            // This handles edge cases like `sip.method == REGISTER` where REGISTER
            // could theoretically conflict with a keyword.
            Token::And => Ok((FilterValue::String("and".to_string()), pos + 1)),
            Token::Or => Ok((FilterValue::String("or".to_string()), pos + 1)),
            Token::Xor => Ok((FilterValue::String("xor".to_string()), pos + 1)),
            Token::Not => Ok((FilterValue::String("not".to_string()), pos + 1)),
            Token::Contains => Ok((FilterValue::String("contains".to_string()), pos + 1)),
            Token::Matches => Ok((FilterValue::String("matches".to_string()), pos + 1)),
            Token::In => Ok((FilterValue::String("in".to_string()), pos + 1)),
            Token::Equals => Ok((FilterValue::String("eq".to_string()), pos + 1)),
            Token::NotEquals => Ok((FilterValue::String("ne".to_string()), pos + 1)),
            Token::GreaterThan => Ok((FilterValue::String("gt".to_string()), pos + 1)),
            Token::LessThan => Ok((FilterValue::String("lt".to_string()), pos + 1)),
            Token::GreaterEqual => Ok((FilterValue::String("ge".to_string()), pos + 1)),
            Token::LessEqual => Ok((FilterValue::String("le".to_string()), pos + 1)),
            _ => Err(anyhow::anyhow!("Expected value, got {:?}", tokens[pos])),
        }
    }

    fn parse_in_set(tokens: &[Token], start: usize, field: &str) -> Result<(FilterCondition, usize)> {
        // field in { v1, v2, ... }
        let mut pos = start + 2; // skip field and 'in'
        if pos >= tokens.len() || !matches!(tokens[pos], Token::LeftBrace) {
            return Err(anyhow::anyhow!("Expected '{{' after 'in'"));
        }
        pos += 1; // skip '{'

        let mut values = Vec::new();
        while pos < tokens.len() && !matches!(tokens[pos], Token::RightBrace) {
            let val = match &tokens[pos] {
                Token::Number(n) => {
                    // Check for range: n..m
                    if pos + 2 < tokens.len() && matches!(tokens[pos + 1], Token::DotDot) {
                        if let Token::Number(m) = tokens[pos + 2] {
                            pos += 3;
                            for v in *n..=m {
                                values.push(FilterValue::Number(v));
                            }
                            // Skip comma if present
                            if pos < tokens.len() && matches!(tokens[pos], Token::Comma) {
                                pos += 1;
                            }
                            continue;
                        }
                    }
                    FilterValue::Number(*n)
                }
                Token::Identifier(s) => {
                    if let Ok(ip) = s.parse::<IpAddr>() {
                        FilterValue::Ip(ip)
                    } else if s.contains('/') {
                        FilterValue::String(s.clone()) // CIDR
                    } else if let Some(n) = parse_number(s) {
                        FilterValue::Number(n)
                    } else {
                        FilterValue::String(s.clone())
                    }
                }
                Token::QuotedString(s) => FilterValue::String(s.clone()),
                Token::Comma => { pos += 1; continue; }
                _ => { pos += 1; continue; }
            };
            values.push(val);
            pos += 1;
            // Skip comma
            if pos < tokens.len() && matches!(tokens[pos], Token::Comma) {
                pos += 1;
            }
        }

        if pos < tokens.len() && matches!(tokens[pos], Token::RightBrace) {
            pos += 1;
        }

        Ok((FilterCondition::InSet { field: field.to_string(), values }, pos))
    }

    fn build_comparison(field: &str, operator: Operator, value: FilterValue) -> Result<FilterCondition> {
        let field_lower = field.to_lowercase();

        // IP address fields
        if field_lower == "ip.addr" || field_lower == "ip.src" || field_lower == "ip.dst" {
            let ip_field = match field_lower.as_str() {
                "ip.addr" => IpField::Addr,
                "ip.src" => IpField::Src,
                "ip.dst" => IpField::Dst,
                _ => unreachable!(),
            };
            let ip_str = match &value {
                FilterValue::String(s) => s.clone(),
                FilterValue::Ip(ip) => ip.to_string(),
                FilterValue::Number(n) => n.to_string(),
            };
            return Ok(FilterCondition::IpAddr { field: ip_field, operator, value: ip_str });
        }

        // Port fields
        if field_lower.ends_with(".port") || field_lower.ends_with(".srcport") || field_lower.ends_with(".dstport") {
            let port_field = if field_lower.ends_with(".srcport") {
                PortField::SrcPort
            } else if field_lower.ends_with(".dstport") {
                PortField::DstPort
            } else {
                PortField::Port
            };
            let port = match &value {
                FilterValue::Number(n) => *n as u16,
                FilterValue::String(s) => s.parse::<u16>().map_err(|_| anyhow::anyhow!("Invalid port: {}", s))?,
                _ => return Err(anyhow::anyhow!("Port field requires numeric value")),
            };
            return Ok(FilterCondition::Port { field: port_field, operator, value: port });
        }

        // Everything else is a generic field comparison
        Ok(FilterCondition::Field { field: field.to_string(), operator, value })
    }

    // ── Evaluation ──────────────────────────────────────────────────────────

    pub fn matches(&self, packet: &crate::packet_capture::PacketInfo) -> bool {
        if self.conditions.is_empty() {
            return true;
        }
        self.conditions.iter().all(|cond| self.evaluate_condition(cond, packet))
    }

    fn evaluate_condition(&self, condition: &FilterCondition, packet: &crate::packet_capture::PacketInfo) -> bool {
        match condition {
            FilterCondition::Protocol(proto) => {
                // Special internal values from parenthesized expression results
                if proto == "__true__" { return true; }
                if proto == "__false__" { return false; }

                let pkt_proto = packet.protocol;
                match proto.as_str() {
                    // IP layer: all packets are IP
                    "ip" | "ipv4" => true,
                    "ipv6" => matches!(packet.src_ip, IpAddr::V6(_)),
                    // Transport layer: match protocol family
                    "tcp" => matches!(pkt_proto, 
                        crate::packet_capture::Protocol::TCP | 
                        crate::packet_capture::Protocol::HTTP | 
                        crate::packet_capture::Protocol::HTTPS
                    ),
                    "udp" => matches!(pkt_proto,
                        crate::packet_capture::Protocol::UDP |
                        crate::packet_capture::Protocol::SIP |
                        crate::packet_capture::Protocol::RTP |
                        crate::packet_capture::Protocol::SRTP |
                        crate::packet_capture::Protocol::RTCP |
                        crate::packet_capture::Protocol::FAX |
                        crate::packet_capture::Protocol::DNS
                    ),
                    // Application layer: exact match
                    "sip" => pkt_proto == crate::packet_capture::Protocol::SIP,
                    "rtp" => pkt_proto == crate::packet_capture::Protocol::RTP || pkt_proto == crate::packet_capture::Protocol::SRTP,
                    "srtp" => pkt_proto == crate::packet_capture::Protocol::SRTP,
                    "rtcp" => pkt_proto == crate::packet_capture::Protocol::RTCP,
                    "dns" => pkt_proto == crate::packet_capture::Protocol::DNS,
                    "http" => pkt_proto == crate::packet_capture::Protocol::HTTP,
                    "https" | "tls" | "ssl" => pkt_proto == crate::packet_capture::Protocol::HTTPS,
                    "fax" | "t38" | "udptl" => pkt_proto == crate::packet_capture::Protocol::FAX,
                    "icmp" => pkt_proto == crate::packet_capture::Protocol::ICMP,
                    "arp" => pkt_proto == crate::packet_capture::Protocol::ARP,
                    // Ethernet layer: all captured packets have ethernet frames
                    "eth" | "ethernet" => true,
                    // Frame pseudo-protocol: matches any packet
                    "frame" => true,
                    _ => false,
                }
            }

            FilterCondition::IpAddr { field, operator, value } => {
                match field {
                    IpField::Addr => {
                        // Wireshark semantics: ip.addr == X means "src OR dst matches X"
                        // ip.addr != X means "src AND dst both don't match X" (no address is X)
                        match operator {
                            Operator::NotEquals => {
                                compare_ip(&packet.src_ip, operator, value) &&
                                compare_ip(&packet.dst_ip, operator, value)
                            }
                            _ => {
                                compare_ip(&packet.src_ip, operator, value) ||
                                compare_ip(&packet.dst_ip, operator, value)
                            }
                        }
                    }
                    IpField::Src => compare_ip(&packet.src_ip, operator, value),
                    IpField::Dst => compare_ip(&packet.dst_ip, operator, value),
                }
            }

            FilterCondition::Port { field, operator, value } => {
                match field {
                    PortField::Port => {
                        // Wireshark semantics: port != X means neither src nor dst is X
                        match operator {
                            Operator::NotEquals => {
                                compare_port(packet.src_port, operator, *value) &&
                                compare_port(packet.dst_port, operator, *value)
                            }
                            _ => {
                                compare_port(packet.src_port, operator, *value) ||
                                compare_port(packet.dst_port, operator, *value)
                            }
                        }
                    }
                    PortField::SrcPort => compare_port(packet.src_port, operator, *value),
                    PortField::DstPort => compare_port(packet.dst_port, operator, *value),
                }
            }

            FilterCondition::Field { field, operator, value } => {
                self.evaluate_field(field, operator, value, packet)
            }

            FilterCondition::Logical { op, left, right } => {
                match op {
                    LogicalOp::And => {
                        self.evaluate_condition(left, packet) && self.evaluate_condition(right, packet)
                    }
                    LogicalOp::Or => {
                        self.evaluate_condition(left, packet) || self.evaluate_condition(right, packet)
                    }
                    LogicalOp::Xor => {
                        self.evaluate_condition(left, packet) ^ self.evaluate_condition(right, packet)
                    }
                }
            }

            FilterCondition::Not(cond) => {
                !self.evaluate_condition(cond, packet)
            }

            FilterCondition::InSet { field, values } => {
                self.evaluate_in_set(field, values, packet)
            }

            FilterCondition::Matches { field, pattern } => {
                self.evaluate_matches(field, pattern, packet)
            }

            FilterCondition::FrameContains(search) => {
                // Search in raw packet data
                let search_lower = search.to_lowercase();
                let data_str = String::from_utf8_lossy(&packet.data);
                data_str.to_lowercase().contains(&search_lower)
            }

            FilterCondition::FieldExists(field) => {
                self.evaluate_field_exists(field, packet)
            }

            FilterCondition::BitwiseAnd { field, mask } => {
                self.evaluate_bitwise_and(field, *mask, packet)
            }
        }
    }

    /// Wireshark field existence check — returns true if the field has a value.
    fn evaluate_field_exists(&self, field: &str, packet: &crate::packet_capture::PacketInfo) -> bool {
        let f = field.to_lowercase();

        // IP fields — present on all IP packets
        if f == "ip.src" || f == "ip.dst" || f == "ip.addr" || f == "ip.ttl" || f == "ip.proto" || f == "ip.id" || f == "ip.len" || f == "ip.version" {
            return true; // all captured packets are IP
        }

        // Ethernet fields
        if f.starts_with("eth.") {
            return packet.decoded.as_ref().and_then(|d| d.ethernet.as_ref()).is_some();
        }

        // TCP fields
        if f.starts_with("tcp.") {
            return matches!(packet.protocol,
                crate::packet_capture::Protocol::TCP |
                crate::packet_capture::Protocol::HTTP |
                crate::packet_capture::Protocol::HTTPS
            );
        }

        // UDP fields
        if f.starts_with("udp.") {
            return matches!(packet.protocol,
                crate::packet_capture::Protocol::UDP |
                crate::packet_capture::Protocol::SIP |
                crate::packet_capture::Protocol::RTP |
                crate::packet_capture::Protocol::SRTP |
                crate::packet_capture::Protocol::RTCP |
                crate::packet_capture::Protocol::FAX |
                crate::packet_capture::Protocol::DNS
            );
        }

        // SIP fields with specific semantics
        if f == "sip.request" {
            // Only SIP requests (have a method, not a response code)
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    return sip.method.is_some();
                }
            }
            return false;
        }
        if f == "sip.response" {
            // Only SIP responses (have a status code)
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    return sip.response_code.is_some();
                }
            }
            return false;
        }
        if f == "sip.method" || f == "sip.request.method" {
            // sip.method exists only on SIP requests
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    return sip.method.is_some();
                }
            }
            return false;
        }
        if f == "sip.status-code" || f == "sip.status_code" || f == "sip.response.code" {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    return sip.response_code.is_some();
                }
            }
            return false;
        }
        if f.starts_with("sip.") {
            // Generic SIP field — true if packet is SIP
            return packet.protocol == crate::packet_capture::Protocol::SIP;
        }

        // RTP fields (also match SRTP since it has the same header structure)
        if f.starts_with("rtp.") {
            return packet.protocol == crate::packet_capture::Protocol::RTP
                || packet.protocol == crate::packet_capture::Protocol::SRTP;
        }

        // RTCP fields
        if f.starts_with("rtcp.") {
            return packet.protocol == crate::packet_capture::Protocol::RTCP;
        }

        // DNS fields
        if f.starts_with("dns.") {
            return packet.protocol == crate::packet_capture::Protocol::DNS;
        }

        // HTTP fields
        if f.starts_with("http.") {
            return packet.protocol == crate::packet_capture::Protocol::HTTP;
        }

        // Frame fields — always present
        if f.starts_with("frame.") {
            return true;
        }

        // Unknown field — not present
        false
    }

    /// Evaluate `field & mask` — true if the bitwise AND result is non-zero.
    fn evaluate_bitwise_and(&self, field: &str, mask: i64, packet: &crate::packet_capture::PacketInfo) -> bool {
        let f = field.to_lowercase();

        // TCP flags
        if f == "tcp.flags" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref tcp) = decoded.tcp {
                    return (tcp.flags as i64 & mask) != 0;
                }
            }
            return false;
        }

        // IP protocol
        if f == "ip.proto" || f == "ip.protocol" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref ip) = decoded.ip {
                    return (ip.protocol as i64 & mask) != 0;
                }
            }
            return false;
        }

        false
    }

    fn evaluate_field(&self, field: &str, operator: &Operator, value: &FilterValue, packet: &crate::packet_capture::PacketInfo) -> bool {
        let field_lower = field.to_lowercase();

        // ── Frame / packet fields ────────────────────────────────────────────
        if field_lower == "frame.len" || field_lower == "frame.length" {
            return compare_number(packet.frame_length as i64, operator, value);
        }
        if field_lower == "frame.time_epoch" {
            // Seconds since Unix epoch
            return compare_number(packet.timestamp.timestamp(), operator, value);
        }
        if field_lower == "ip.len" || field_lower == "ip.length" {
            return compare_number(packet.size as i64, operator, value);
        }
        if field_lower == "udp.length" || field_lower == "udp.len" {
            return compare_number((packet.size + 8) as i64, operator, value); // UDP header + payload
        }
        if field_lower == "tcp.len" || field_lower == "tcp.length" {
            return compare_number(packet.size as i64, operator, value); // TCP payload length
        }

        // ── Ethernet fields ─────────────────────────────────────────────────
        if field_lower.starts_with("eth.") {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref eth) = decoded.ethernet {
                    let field_val = match field_lower.as_str() {
                        "eth.src" => &eth.src_mac,
                        "eth.dst" => &eth.dst_mac,
                        "eth.addr" => {
                            // Match either src or dst
                            let val_str = filter_value_to_string(value);
                            let val_lower = val_str.to_lowercase();
                            return eth.src_mac.to_lowercase() == val_lower || eth.dst_mac.to_lowercase() == val_lower;
                        }
                        "eth.type" => {
                            return compare_number(eth.ethertype as i64, operator, value);
                        }
                        _ => return false,
                    };
                    return compare_string(field_val, operator, value);
                }
            }
            return false;
        }

        // ── SIP fields ──────────────────────────────────────────────────────
        if field_lower.starts_with("sip.") {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    return evaluate_sip_field(&field_lower, operator, value, sip);
                }
            }
            return false;
        }

        // ── DNS fields ──────────────────────────────────────────────────────
        if field_lower.starts_with("dns.") {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Dns(ref dns) = decoded.application {
                    return evaluate_dns_field(&field_lower, operator, value, dns);
                }
            }
            return false;
        }

        // ── RTP fields ──────────────────────────────────────────────────────
        if field_lower.starts_with("rtp.") {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Rtp(ref rtp) = decoded.application {
                    return evaluate_rtp_field(&field_lower, operator, value, rtp);
                }
            }
            return false;
        }

        // ── TCP flags ───────────────────────────────────────────────────────
        if field_lower.starts_with("tcp.flags") {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref tcp) = decoded.tcp {
                    let flags = tcp.flags;
                    let flag_val = match field_lower.as_str() {
                        "tcp.flags" => flags as i64,
                        "tcp.flags.syn" => ((flags & 0x02) != 0) as i64,
                        "tcp.flags.ack" => ((flags & 0x10) != 0) as i64,
                        "tcp.flags.fin" => ((flags & 0x01) != 0) as i64,
                        "tcp.flags.rst" | "tcp.flags.reset" => ((flags & 0x04) != 0) as i64,
                        "tcp.flags.push" | "tcp.flags.psh" => ((flags & 0x08) != 0) as i64,
                        "tcp.flags.urg" => ((flags & 0x20) != 0) as i64,
                        _ => return false,
                    };
                    return compare_number(flag_val, operator, value);
                }
            }
            return false;
        }

        // ── TCP/UDP sequence/window/stream ──────────────────────────────────
        if field_lower == "tcp.seq" || field_lower == "tcp.sequence" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref tcp) = decoded.tcp {
                    return compare_number(tcp.sequence as i64, operator, value);
                }
            }
            return false;
        }
        if field_lower == "tcp.ack" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref tcp) = decoded.tcp {
                    return compare_number(tcp.acknowledgment as i64, operator, value);
                }
            }
            return false;
        }
        if field_lower == "tcp.window" || field_lower == "tcp.window_size" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref tcp) = decoded.tcp {
                    return compare_number(tcp.window as i64, operator, value);
                }
            }
            return false;
        }

        // ── IP version ───────────────────────────────────────────────────────
        if field_lower == "ip.version" {
            let version: i64 = if matches!(packet.src_ip, IpAddr::V6(_)) { 6 } else { 4 };
            return compare_number(version, operator, value);
        }

        // ── IP TTL / protocol ───────────────────────────────────────────────
        if field_lower == "ip.ttl" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref ip) = decoded.ip {
                    return compare_number(ip.ttl as i64, operator, value);
                }
            }
            return false;
        }
        if field_lower == "ip.proto" || field_lower == "ip.protocol" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref ip) = decoded.ip {
                    return compare_number(ip.protocol as i64, operator, value);
                }
            }
            return false;
        }
        if field_lower == "ip.id" {
            if let Some(ref decoded) = packet.decoded {
                if let Some(ref ip) = decoded.ip {
                    return compare_number(ip.identification as i64, operator, value);
                }
            }
            return false;
        }

        // ── "frame" field: search in raw data ───────────────────────────────
        if field_lower == "frame" {
            if *operator == Operator::Contains {
                let search = filter_value_to_string(value).to_lowercase();
                let data_str = String::from_utf8_lossy(&packet.data);
                return data_str.to_lowercase().contains(&search);
            }
            return false;
        }

        false
    }

    fn evaluate_in_set(&self, field: &str, values: &[FilterValue], packet: &crate::packet_capture::PacketInfo) -> bool {
        let field_lower = field.to_lowercase();

        // IP address sets
        if field_lower == "ip.addr" || field_lower == "ip.src" || field_lower == "ip.dst" {
            let ips_to_check: Vec<&IpAddr> = match field_lower.as_str() {
                "ip.addr" => vec![&packet.src_ip, &packet.dst_ip],
                "ip.src" => vec![&packet.src_ip],
                "ip.dst" => vec![&packet.dst_ip],
                _ => return false,
            };
            for ip in &ips_to_check {
                for val in values {
                    let val_str = filter_value_to_string(val);
                    if compare_ip(ip, &Operator::Equals, &val_str) {
                        return true;
                    }
                }
            }
            return false;
        }

        // Port sets
        if field_lower.ends_with(".port") || field_lower.ends_with(".srcport") || field_lower.ends_with(".dstport") {
            let ports_to_check: Vec<u16> = if field_lower.ends_with(".srcport") {
                vec![packet.src_port]
            } else if field_lower.ends_with(".dstport") {
                vec![packet.dst_port]
            } else {
                vec![packet.src_port, packet.dst_port]
            };

            for port in &ports_to_check {
                for val in values {
                    if let FilterValue::Number(n) = val {
                        if *port == *n as u16 {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        false
    }

    fn evaluate_matches(&self, field: &str, pattern: &str, packet: &crate::packet_capture::PacketInfo) -> bool {
        let re = match regex::Regex::new(&format!("(?i){}", pattern)) {
            Ok(r) => r,
            Err(_) => return false,
        };

        let field_lower = field.to_lowercase();

        // Frame content
        if field_lower == "frame" {
            let data_str = String::from_utf8_lossy(&packet.data);
            return re.is_match(&data_str);
        }

        // SIP fields
        if field_lower.starts_with("sip.") {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Sip(ref sip) = decoded.application {
                    let val = get_sip_field_value(&field_lower, sip);
                    return re.is_match(&val);
                }
            }
            return false;
        }

        // DNS query name
        if field_lower == "dns.qry.name" {
            if let Some(ref decoded) = packet.decoded {
                if let ApplicationLayer::Dns(ref dns) = decoded.application {
                    return dns.queries.iter().any(|q| re.is_match(&q.name));
                }
            }
            return false;
        }

        false
    }
}

// ─── Helper Functions ───────────────────────────────────────────────────────

fn parse_number(s: &str) -> Option<i64> {
    // Hex: 0x...
    if s.starts_with("0x") || s.starts_with("0X") {
        return i64::from_str_radix(&s[2..], 16).ok();
    }
    // Octal: 0...
    if s.starts_with('0') && s.len() > 1 && s.chars().all(|c| c.is_ascii_digit()) {
        return i64::from_str_radix(&s[1..], 8).ok();
    }
    // Decimal
    s.parse::<i64>().ok()
}

fn is_protocol_name(s: &str) -> bool {
    matches!(s,
        "ip" | "ipv4" | "ipv6" |
        "tcp" | "udp" |
        "sip" | "rtp" | "srtp" | "rtcp" |
        "dns" | "http" | "https" | "tls" | "ssl" |
        "fax" | "t38" | "udptl" |
        "icmp" | "icmpv6" | "arp" |
        "eth" | "ethernet" | "frame"
    )
}

/// Convert a keyword token to its string representation (for value positions).
fn token_to_string(token: &Token) -> Option<String> {
    match token {
        Token::And => Some("and".to_string()),
        Token::Or => Some("or".to_string()),
        Token::Xor => Some("xor".to_string()),
        Token::Not => Some("not".to_string()),
        Token::Contains => Some("contains".to_string()),
        Token::Matches => Some("matches".to_string()),
        Token::In => Some("in".to_string()),
        Token::Equals => Some("eq".to_string()),
        Token::NotEquals => Some("ne".to_string()),
        Token::GreaterThan => Some("gt".to_string()),
        Token::LessThan => Some("lt".to_string()),
        Token::GreaterEqual => Some("ge".to_string()),
        Token::LessEqual => Some("le".to_string()),
        Token::Identifier(s) => Some(s.clone()),
        Token::QuotedString(s) => Some(s.clone()),
        Token::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn is_operator_token(token: &Token) -> bool {
    matches!(token,
        Token::Equals | Token::NotEquals |
        Token::GreaterThan | Token::LessThan |
        Token::GreaterEqual | Token::LessEqual |
        Token::Contains | Token::Matches | Token::In |
        Token::BitwiseAnd
    )
}

fn compare_ip(ip: &IpAddr, operator: &Operator, value: &str) -> bool {
    // Try exact IP match
    if let Ok(value_ip) = value.parse::<IpAddr>() {
        return match operator {
            Operator::Equals => ip == &value_ip,
            Operator::NotEquals => ip != &value_ip,
            _ => false,
        };
    }
    // Try CIDR match
    if let Ok(network) = value.parse::<IpNetwork>() {
        return match operator {
            Operator::Equals => network.contains(*ip),
            Operator::NotEquals => !network.contains(*ip),
            _ => false,
        };
    }
    false
}

fn compare_port(port: u16, operator: &Operator, value: u16) -> bool {
    match operator {
        Operator::Equals => port == value,
        Operator::NotEquals => port != value,
        Operator::GreaterThan => port > value,
        Operator::LessThan => port < value,
        Operator::GreaterEqual => port >= value,
        Operator::LessEqual => port <= value,
        _ => false,
    }
}

fn compare_number(field_val: i64, operator: &Operator, value: &FilterValue) -> bool {
    let target = match value {
        FilterValue::Number(n) => *n,
        FilterValue::String(s) => {
            if let Some(n) = parse_number(s) { n } else { return false; }
        }
        _ => return false,
    };
    match operator {
        Operator::Equals => field_val == target,
        Operator::NotEquals => field_val != target,
        Operator::GreaterThan => field_val > target,
        Operator::LessThan => field_val < target,
        Operator::GreaterEqual => field_val >= target,
        Operator::LessEqual => field_val <= target,
        _ => false,
    }
}

fn compare_string(field_val: &str, operator: &Operator, value: &FilterValue) -> bool {
    let search = filter_value_to_string(value);
    match operator {
        Operator::Equals => field_val.eq_ignore_ascii_case(&search),
        Operator::NotEquals => !field_val.eq_ignore_ascii_case(&search),
        Operator::Contains => field_val.to_lowercase().contains(&search.to_lowercase()),
        _ => false,
    }
}

fn filter_value_to_string(v: &FilterValue) -> String {
    match v {
        FilterValue::String(s) => s.clone(),
        FilterValue::Number(n) => n.to_string(),
        FilterValue::Ip(ip) => ip.to_string(),
    }
}

// ─── SIP Field Evaluation ───────────────────────────────────────────────────

fn get_sip_field_value(field: &str, sip: &crate::packet_capture::sip_parser::ParsedSipMessage) -> String {
    match field {
        "sip.method" | "sip.request.method" => sip.method.as_deref().unwrap_or("").to_string(),
        "sip.status-code" | "sip.status_code" | "sip.response.code" | "sip.status-line" => {
            sip.response_code.map(|c| c.to_string()).unwrap_or_default()
        }
        "sip.call-id" | "sip.callid" | "sip.call_id" => sip.call_id.as_deref().unwrap_or("").to_string(),
        "sip.from" | "sip.from.addr" => sip.from.as_deref().unwrap_or("").to_string(),
        "sip.to" | "sip.to.addr" => sip.to.as_deref().unwrap_or("").to_string(),
        "sip.request-uri" | "sip.r-uri" | "sip.requesturi" => sip.request_uri.as_deref().unwrap_or("").to_string(),
        "sip.user-agent" | "sip.user_agent" => sip.headers.get("user-agent").cloned().unwrap_or_default(),
        "sip.expires" => sip.headers.get("expires").cloned().unwrap_or_default(),
        "sip.contact" | "sip.contact.addr" => sip.contact.as_deref().unwrap_or("").to_string(),
        "sip.cseq" => sip.cseq.as_deref().unwrap_or("").to_string(),
        "sip.cseq.num" => {
            sip.cseq.as_deref().unwrap_or("")
                .split_whitespace().next().unwrap_or("").to_string()
        }
        "sip.cseq.method" => {
            sip.cseq.as_deref().unwrap_or("")
                .split_whitespace().nth(1).unwrap_or("").to_string()
        }
        "sip.via" => sip.via.first().cloned().unwrap_or_default(),
        "sip.content-type" | "sip.content_type" => sip.content_type.as_deref().unwrap_or("").to_string(),
        "sip.content-length" | "sip.content_length" => {
            sip.content_length.map(|l| l.to_string()).unwrap_or_default()
        }
        "sip.response_text" | "sip.reason" => sip.response_text.as_deref().unwrap_or("").to_string(),
        _ => {
            // Try generic header lookup: sip.xxx → header "xxx"
            let header_name = if field.starts_with("sip.") { &field[4..] } else { field };
            sip.headers.get(header_name).cloned()
                .or_else(|| sip.headers.get(&header_name.to_lowercase()).cloned())
                .unwrap_or_default()
        }
    }
}

fn evaluate_sip_field(field: &str, operator: &Operator, value: &FilterValue, sip: &crate::packet_capture::sip_parser::ParsedSipMessage) -> bool {
    // Auth parameter special handling
    if field.starts_with("sip.auth.") {
        let auth_field = &field[9..];
        let auth_header = sip.headers.get("www-authenticate")
            .or_else(|| sip.headers.get("authorization"))
            .or_else(|| sip.headers.get("proxy-authenticate"))
            .or_else(|| sip.headers.get("proxy-authorization"))
            .map(|s| s.as_str())
            .unwrap_or("");
        let param_value = extract_auth_param(auth_header, auth_field);
        return compare_string(&param_value, operator, value);
    }

    // Numeric SIP fields
    if field == "sip.status-code" || field == "sip.status_code" || field == "sip.response.code" {
        if let Some(code) = sip.response_code {
            return compare_number(code as i64, operator, value);
        }
        return false;
    }
    if field == "sip.content-length" || field == "sip.content_length" {
        if let Some(len) = sip.content_length {
            return compare_number(len as i64, operator, value);
        }
        return false;
    }
    if field == "sip.cseq.num" {
        let num_str = sip.cseq.as_deref().unwrap_or("")
            .split_whitespace().next().unwrap_or("0");
        if let Ok(n) = num_str.parse::<i64>() {
            return compare_number(n, operator, value);
        }
        return false;
    }

    // String SIP fields
    let field_value = get_sip_field_value(field, sip);
    compare_string(&field_value, operator, value)
}

fn extract_auth_param(auth_header: &str, param_name: &str) -> String {
    let search = format!("{}=", param_name);
    if let Some(pos) = auth_header.to_lowercase().find(&search.to_lowercase()) {
        let after_eq = &auth_header[pos + search.len()..];
        if after_eq.starts_with('"') {
            if let Some(end) = after_eq[1..].find('"') {
                return after_eq[1..=end].to_string();
            }
        } else {
            let end = after_eq.find(',').unwrap_or(after_eq.len());
            return after_eq[..end].trim().to_string();
        }
    }
    String::new()
}

// ─── DNS Field Evaluation ───────────────────────────────────────────────────

fn evaluate_dns_field(field: &str, operator: &Operator, value: &FilterValue, dns: &crate::packet_capture::dns_parser::DnsMessage) -> bool {
    match field {
        "dns.qry.name" | "dns.query.name" => {
            let search = filter_value_to_string(value);
            dns.queries.iter().any(|q| compare_string(&q.name, operator, &FilterValue::String(search.clone())))
        }
        "dns.flags.response" => {
            let is_response = if dns.is_response { 1i64 } else { 0 };
            compare_number(is_response, operator, value)
        }
        "dns.qry.type" | "dns.query.type" => {
            // Support type names
            let target_type = match value {
                FilterValue::Number(n) => Some(*n as u16),
                FilterValue::String(s) => {
                    match s.to_uppercase().as_str() {
                        "A" => Some(1), "NS" => Some(2), "CNAME" => Some(5),
                        "SOA" => Some(6), "PTR" => Some(12), "MX" => Some(15),
                        "TXT" => Some(16), "AAAA" => Some(28), "SRV" => Some(33),
                        "NAPTR" => Some(35), "ANY" => Some(255),
                        _ => s.parse::<u16>().ok(),
                    }
                }
                _ => None,
            };
            if let Some(target) = target_type {
                dns.queries.iter().any(|q| compare_port(q.qtype, operator, target))
            } else {
                false
            }
        }
        "dns.count.queries" | "dns.qdcount" => {
            compare_number(dns.questions as i64, operator, value)
        }
        "dns.count.answers" | "dns.ancount" => {
            compare_number(dns.answer_rrs as i64, operator, value)
        }
        _ => false,
    }
}

// ─── RTP Field Evaluation ───────────────────────────────────────────────────

fn evaluate_rtp_field(field: &str, operator: &Operator, value: &FilterValue, rtp: &crate::packet_capture::rtp_analyzer::RtpHeader) -> bool {
    match field {
        "rtp.version" => compare_number(rtp.version as i64, operator, value),
        "rtp.p_type" | "rtp.payload_type" | "rtp.pt" => compare_number(rtp.payload_type as i64, operator, value),
        "rtp.seq" | "rtp.sequence" | "rtp.sequence_number" => compare_number(rtp.sequence_number as i64, operator, value),
        "rtp.timestamp" | "rtp.ts" => compare_number(rtp.timestamp as i64, operator, value),
        "rtp.ssrc" => {
            // Support hex SSRC
            let target = match value {
                FilterValue::Number(n) => Some(*n as u32),
                FilterValue::String(s) => {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u32::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse::<u32>().ok()
                    }
                }
                _ => None,
            };
            if let Some(t) = target {
                match operator {
                    Operator::Equals => rtp.ssrc == t,
                    Operator::NotEquals => rtp.ssrc != t,
                    _ => false,
                }
            } else {
                false
            }
        }
        "rtp.marker" => {
            let marker_val = if rtp.marker { 1i64 } else { 0 };
            compare_number(marker_val, operator, value)
        }
        "rtp.csrc" | "rtp.csrc.count" | "rtp.cc" => compare_number(rtp.csrc_count as i64, operator, value),
        "rtp.padding" => {
            let pad_val = if rtp.padding { 1i64 } else { 0 };
            compare_number(pad_val, operator, value)
        }
        "rtp.ext" | "rtp.extension" => {
            let ext_val = if rtp.extension { 1i64 } else { 0 };
            compare_number(ext_val, operator, value)
        }
        _ => false,
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packet_capture::{PacketFidelity, PacketProvenance, Protocol};
    use std::net::IpAddr;
    use chrono::Utc;

    /// Helper to create a basic test packet.
    fn make_packet(proto: Protocol, src_ip: &str, dst_ip: &str, src_port: u16, dst_port: u16) -> crate::packet_capture::PacketInfo {
        crate::packet_capture::PacketInfo {
            timestamp: Utc::now(),
            src_ip: src_ip.parse::<IpAddr>().unwrap(),
            dst_ip: dst_ip.parse::<IpAddr>().unwrap(),
            src_port,
            dst_port,
            protocol: proto,
            size: 200,
            frame_length: 242,
            raw_frame: None,
            data: b"SIP/2.0 200 OK\r\nContent-Length: 0\r\n".to_vec(),
            decoded: None,
            fidelity: PacketFidelity::Simulated,
            provenance: PacketProvenance::Unknown,
        }
    }

    fn make_sip_packet(src_ip: &str, dst_ip: &str) -> crate::packet_capture::PacketInfo {
        make_packet(Protocol::SIP, src_ip, dst_ip, 5060, 5060)
    }

    fn make_rtp_packet(src_ip: &str, dst_ip: &str) -> crate::packet_capture::PacketInfo {
        make_packet(Protocol::RTP, src_ip, dst_ip, 10000, 20000)
    }

    fn make_dns_packet() -> crate::packet_capture::PacketInfo {
        make_packet(Protocol::DNS, "10.0.0.1", "8.8.8.8", 12345, 53)
    }

    fn eval(filter_str: &str, packet: &crate::packet_capture::PacketInfo) -> bool {
        let filter = WiresharkFilter::parse(filter_str).unwrap();
        filter.matches(packet)
    }

    // ── Parse Tests ──────────────────────────────────────────────────────

    #[test]
    fn test_parse_protocol() {
        let f = WiresharkFilter::parse("sip").unwrap();
        assert_eq!(f.conditions.len(), 1);
    }

    #[test]
    fn test_parse_and_or_operators() {
        // All these must parse without error
        WiresharkFilter::parse("sip && rtp").unwrap();
        WiresharkFilter::parse("sip || rtp").unwrap();
        WiresharkFilter::parse("sip and rtp").unwrap();
        WiresharkFilter::parse("sip or rtp").unwrap();
        WiresharkFilter::parse("sip ^^ rtp").unwrap();
        WiresharkFilter::parse("sip xor rtp").unwrap();
    }

    #[test]
    fn test_parse_complex_logical() {
        WiresharkFilter::parse("sip && ip.addr == 192.168.1.1").unwrap();
        WiresharkFilter::parse("sip and not rtp or dns").unwrap();
        WiresharkFilter::parse("(sip || rtp) && ip.addr == 10.0.0.1").unwrap();
        WiresharkFilter::parse("!(sip || rtp)").unwrap();
        WiresharkFilter::parse("!sip.method == \"INVITE\"").unwrap();
        WiresharkFilter::parse("(sip || rtp) && ip.addr == 10.0.0.1 && frame.len > 100").unwrap();
    }

    #[test]
    fn test_parse_comparisons() {
        WiresharkFilter::parse("ip.addr == 192.168.1.1").unwrap();
        WiresharkFilter::parse("udp.port == 5060").unwrap();
        WiresharkFilter::parse("frame.len > 1500").unwrap();
        WiresharkFilter::parse("sip.status-code == 200").unwrap();
        WiresharkFilter::parse("sip.status-code >= 200 && sip.status-code < 300").unwrap();
        WiresharkFilter::parse("tcp.flags.syn == 1").unwrap();
        WiresharkFilter::parse("ip.version == 4").unwrap();
        WiresharkFilter::parse("ip.addr == 192.168.1.0/24").unwrap();
        WiresharkFilter::parse("rtp.ssrc == 0x12345678").unwrap();
        WiresharkFilter::parse("sip.method == INVITE").unwrap();
    }

    #[test]
    fn test_parse_special_operators() {
        WiresharkFilter::parse("sip.method contains \"INVITE\"").unwrap();
        WiresharkFilter::parse("sip.method ~ \"INVITE|REGISTER\"").unwrap();
        WiresharkFilter::parse("tcp.port in {80, 443, 8080}").unwrap();
        WiresharkFilter::parse("frame contains \"SIP/2.0\"").unwrap();
    }

    #[test]
    fn test_parse_field_existence() {
        let f = WiresharkFilter::parse("sip.method").unwrap();
        assert!(matches!(f.conditions[0], FilterCondition::FieldExists(_)));
        WiresharkFilter::parse("tcp.port").unwrap();
        WiresharkFilter::parse("sip.request").unwrap();
        WiresharkFilter::parse("sip.response").unwrap();
    }

    #[test]
    fn test_parse_implicit_and() {
        let f = WiresharkFilter::parse("sip rtp").unwrap();
        assert!(matches!(f.conditions[0], FilterCondition::Logical { op: LogicalOp::And, .. }));
        WiresharkFilter::parse("ip.src == 10.0.0.1 ip.dst == 10.0.0.2").unwrap();
        WiresharkFilter::parse("(ip.src == 10.0.0.1 ip.dst == 10.0.0.2)").unwrap();
    }

    #[test]
    fn test_parse_bitwise_and() {
        let f = WiresharkFilter::parse("tcp.flags & 0x02").unwrap();
        assert!(matches!(f.conditions[0], FilterCondition::BitwiseAnd { .. }));
    }

    #[test]
    fn test_parse_no_spaces() {
        // No spaces around operators
        WiresharkFilter::parse("sip&&rtp").unwrap();
        WiresharkFilter::parse("sip||rtp").unwrap();
        WiresharkFilter::parse("ip.addr==10.0.0.1").unwrap();
        WiresharkFilter::parse("!sip").unwrap();
        WiresharkFilter::parse("!(sip||rtp)").unwrap();
    }

    #[test]
    fn test_parse_single_pipe_error() {
        // Single | should produce an error, not be silently consumed
        assert!(WiresharkFilter::parse("sip | rtp").is_err());
    }

    #[test]
    fn test_parse_protocols() {
        for proto in &["ip", "ipv4", "ipv6", "tcp", "udp", "sip", "rtp", "rtcp",
                        "dns", "http", "https", "tls", "ssl", "fax", "t38", "icmp",
                        "arp", "eth", "ethernet", "frame"] {
            WiresharkFilter::parse(proto).unwrap();
        }
    }

    // ── Evaluation Tests ─────────────────────────────────────────────────

    #[test]
    fn test_eval_protocol_match() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        let rtp_pkt = make_rtp_packet("10.0.0.1", "10.0.0.2");

        assert!(eval("sip", &sip_pkt));
        assert!(!eval("sip", &rtp_pkt));
        assert!(eval("rtp", &rtp_pkt));
        assert!(!eval("rtp", &sip_pkt));
        assert!(eval("ip", &sip_pkt));    // All packets are IP
        assert!(eval("udp", &sip_pkt));   // SIP is over UDP
        assert!(!eval("tcp", &sip_pkt));  // SIP is not TCP
        assert!(eval("eth", &sip_pkt));   // All packets have ethernet
        assert!(eval("frame", &sip_pkt)); // All packets match frame
    }

    #[test]
    fn test_eval_logical_and() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");

        // sip && udp -> true for SIP (SIP is over UDP)
        assert!(eval("sip && udp", &sip_pkt));
        // sip && rtp -> false (can't be both)
        assert!(!eval("sip && rtp", &sip_pkt));
        // English keywords
        assert!(eval("sip and udp", &sip_pkt));
        assert!(!eval("sip and rtp", &sip_pkt));
    }

    #[test]
    fn test_eval_logical_or() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        let dns_pkt = make_dns_packet();

        assert!(eval("sip || rtp", &sip_pkt));    // SIP matches
        assert!(eval("sip || rtp", &sip_pkt));
        assert!(!eval("dns || rtp", &sip_pkt));   // Neither matches SIP
        assert!(eval("dns || rtp", &dns_pkt));    // DNS matches
        // English keywords
        assert!(eval("sip or rtp", &sip_pkt));
    }

    #[test]
    fn test_eval_logical_xor() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");

        // sip XOR udp: sip=true, udp=true → false (both true)
        assert!(!eval("sip ^^ udp", &sip_pkt));
        // sip XOR rtp: sip=true, rtp=false → true (exactly one true)
        assert!(eval("sip ^^ rtp", &sip_pkt));
        // sip XOR ip: sip=true, ip=true → false
        assert!(!eval("sip xor ip", &sip_pkt));
    }

    #[test]
    fn test_eval_negation() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        let rtp_pkt = make_rtp_packet("10.0.0.1", "10.0.0.2");

        assert!(!eval("!sip", &sip_pkt));
        assert!(eval("!sip", &rtp_pkt));
        assert!(eval("not sip", &rtp_pkt));
        assert!(eval("!rtp", &sip_pkt));
    }

    #[test]
    fn test_eval_operator_precedence() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        let dns_pkt = make_dns_packet();

        // "sip || rtp && dns" should be "sip || (rtp && dns)"
        // For SIP packet: sip=true → true (short circuit OR)
        assert!(eval("sip || rtp && dns", &sip_pkt));
        // For DNS packet: sip=false, rtp=false → rtp&&dns = false → false
        assert!(!eval("sip || rtp && dns", &dns_pkt));

        // "(sip || rtp) && dns" — explicit grouping
        // For SIP packet: (sip||rtp)=true, dns=false → false
        assert!(!eval("(sip || rtp) && dns", &sip_pkt));

        // NOT binds tighter than AND
        // "!sip && udp" = "(!sip) && udp"
        // For SIP pkt: (!true) && true = false
        assert!(!eval("!sip && udp", &sip_pkt));
    }

    #[test]
    fn test_eval_ip_address() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2");

        assert!(eval("ip.addr == 10.0.0.1", &pkt));
        assert!(eval("ip.addr == 10.0.0.2", &pkt));
        assert!(!eval("ip.addr == 10.0.0.3", &pkt));
        assert!(eval("ip.src == 10.0.0.1", &pkt));
        assert!(!eval("ip.src == 10.0.0.2", &pkt));
        assert!(eval("ip.dst == 10.0.0.2", &pkt));
    }

    #[test]
    fn test_eval_ip_addr_not_equals() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2");

        // ip.addr != 10.0.0.1 means NEITHER src NOR dst is 10.0.0.1 (AND semantics)
        assert!(!eval("ip.addr != 10.0.0.1", &pkt)); // src IS 10.0.0.1
        assert!(!eval("ip.addr != 10.0.0.2", &pkt)); // dst IS 10.0.0.2
        assert!(eval("ip.addr != 10.0.0.3", &pkt));  // neither is 10.0.0.3
    }

    #[test]
    fn test_eval_port() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2"); // ports: 5060, 5060

        assert!(eval("udp.port == 5060", &pkt));
        assert!(!eval("udp.port == 5061", &pkt));
        assert!(eval("udp.srcport == 5060", &pkt));
        assert!(eval("udp.dstport == 5060", &pkt));
    }

    #[test]
    fn test_eval_port_not_equals() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2"); // ports: 5060, 5060

        // port != 5060: neither src nor dst should be 5060 → false
        assert!(!eval("udp.port != 5060", &pkt));
        // port != 5061: neither is 5061 → true
        assert!(eval("udp.port != 5061", &pkt));
    }

    #[test]
    fn test_eval_frame_len() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2"); // frame_length: 242

        assert!(eval("frame.len == 242", &pkt));
        assert!(eval("frame.len > 100", &pkt));
        assert!(!eval("frame.len > 500", &pkt));
        assert!(eval("frame.len >= 242", &pkt));
        assert!(eval("frame.len <= 242", &pkt));
        assert!(!eval("frame.len < 242", &pkt));
    }

    #[test]
    fn test_eval_frame_contains() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2"); // data contains "SIP/2.0"

        assert!(eval("frame contains \"SIP/2.0\"", &pkt));
        assert!(eval("frame contains \"sip/2.0\"", &pkt)); // case-insensitive
        assert!(!eval("frame contains \"HTTP/1.1\"", &pkt));
    }

    #[test]
    fn test_eval_cidr() {
        let pkt = make_sip_packet("192.168.1.100", "10.0.0.2");

        assert!(eval("ip.src == 192.168.1.0/24", &pkt));
        assert!(!eval("ip.src == 192.168.2.0/24", &pkt));
        assert!(eval("ip.addr == 192.168.1.0/24", &pkt));
    }

    #[test]
    fn test_eval_in_set() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2"); // port 5060

        assert!(eval("udp.port in {5060, 5061, 5062}", &pkt));
        assert!(!eval("udp.port in {80, 443}", &pkt));
    }

    #[test]
    fn test_eval_triple_and() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        // sip && udp && ip → all true for SIP packet
        assert!(eval("sip && udp && ip", &pkt));
        // sip && rtp && ip → false (not RTP)
        assert!(!eval("sip && rtp && ip", &pkt));
    }

    #[test]
    fn test_eval_triple_or() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        assert!(eval("sip || rtp || dns", &pkt));
        assert!(!eval("rtp || dns || http", &pkt));
    }

    #[test]
    fn test_eval_mixed_and_or() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        let rtp_pkt = make_rtp_packet("10.0.0.1", "10.0.0.2");

        // "sip || rtp && ip.addr == 10.0.0.1"
        // = sip || (rtp && ip.addr == 10.0.0.1) due to precedence
        assert!(eval("sip || rtp && ip.addr == 10.0.0.1", &sip_pkt));
        assert!(eval("sip || rtp && ip.addr == 10.0.0.1", &rtp_pkt));
        assert!(!eval("sip || rtp && ip.addr == 10.0.0.99", &rtp_pkt));
    }

    #[test]
    fn test_eval_not_with_or() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        // "not sip or rtp" = (not sip) or rtp = false or false = false for SIP
        assert!(!eval("not sip or rtp", &sip_pkt));
        // "not (sip or rtp)" = not true = false
        assert!(!eval("not (sip or rtp)", &sip_pkt));
    }

    #[test]
    fn test_eval_parenthesized_or_and() {
        let sip_pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        // "(sip || rtp) && ip.addr == 10.0.0.1"
        assert!(eval("(sip || rtp) && ip.addr == 10.0.0.1", &sip_pkt));
        assert!(!eval("(sip || rtp) && ip.addr == 10.0.0.99", &sip_pkt));
    }

    #[test]
    fn test_eval_empty_filter() {
        let pkt = make_sip_packet("10.0.0.1", "10.0.0.2");
        assert!(eval("", &pkt)); // Empty filter matches everything
    }
}
