use anyhow::Result;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DnsMessage {
    #[serde(rename = "transactionId")]
    pub transaction_id: u16,
    pub flags: u16,
    pub questions: u16,
    #[serde(rename = "answerRrs")]
    pub answer_rrs: u16,
    #[serde(rename = "authorityRrs")]
    pub authority_rrs: u16,
    #[serde(rename = "additionalRrs")]
    pub additional_rrs: u16,
    pub queries: Vec<DnsQuery>,
    pub answers: Vec<DnsResourceRecord>,
    #[serde(rename = "isResponse")]
    pub is_response: bool,
    pub opcode: u8,
    #[serde(rename = "responseCode")]
    pub response_code: u8,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DnsQuery {
    pub name: String,
    pub qtype: u16,
    pub qclass: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DnsResourceRecord {
    pub name: String,
    pub rtype: u16,
    pub rclass: u16,
    pub ttl: u32,
    pub data: String, // IP address or domain name
}

pub fn parse_dns_message(data: &[u8]) -> Result<DnsMessage> {
    if data.len() < 12 {
        anyhow::bail!("DNS message too short");
    }

    let transaction_id = u16::from_be_bytes([data[0], data[1]]);
    let flags = u16::from_be_bytes([data[2], data[3]]);
    let questions = u16::from_be_bytes([data[4], data[5]]);
    let answer_rrs = u16::from_be_bytes([data[6], data[7]]);
    let authority_rrs = u16::from_be_bytes([data[8], data[9]]);
    let additional_rrs = u16::from_be_bytes([data[10], data[11]]);

    let is_response = (flags & 0x8000) != 0;
    let opcode = ((flags >> 11) & 0x0F) as u8;
    let response_code = (flags & 0x000F) as u8;

    let mut offset = 12;
    let mut queries = Vec::new();
    let mut answers = Vec::new();

    // Parse questions
    for _ in 0..questions {
        if offset >= data.len() {
            break; // Truncated, but return what we have
        }

        match parse_dns_name(data, offset) {
            Ok((name, new_offset)) => {
                offset = new_offset;

                if offset + 4 > data.len() {
                    break; // Truncated, but return what we have
                }

                let qtype = u16::from_be_bytes([data[offset], data[offset + 1]]);
                let qclass = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
                offset += 4;

                queries.push(DnsQuery {
                    name,
                    qtype,
                    qclass,
                });
            }
            Err(_) => {
                // Name parsing failed, skip this question
                break;
            }
        }
    }

    // Parse answers
    for _ in 0..answer_rrs {
        if offset >= data.len() {
            break; // Truncated, but return what we have
        }

        let (name, new_offset) = match parse_dns_name(data, offset) {
            Ok(result) => result,
            Err(_) => break, // Name parsing failed, skip remaining answers
        };
        offset = new_offset;

        if offset + 10 > data.len() {
            break; // Truncated, but return what we have
        }

        let rtype = u16::from_be_bytes([data[offset], data[offset + 1]]);
        let rclass = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
        let ttl = u32::from_be_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        let data_length = u16::from_be_bytes([data[offset + 8], data[offset + 9]]) as usize;
        offset += 10;

        if offset + data_length > data.len() {
            break; // Truncated, but return what we have
        }

        let record_data = match rtype {
            1 => {
                // A record - IPv4 address
                if data_length == 4 {
                    format!(
                        "{}.{}.{}.{}",
                        data[offset],
                        data[offset + 1],
                        data[offset + 2],
                        data[offset + 3]
                    )
                } else {
                    String::from("Invalid A record")
                }
            }
            28 => {
                // AAAA record - IPv6 address
                if data_length == 16 {
                    let mut parts = Vec::new();
                    for i in 0..8 {
                        let val =
                            u16::from_be_bytes([data[offset + i * 2], data[offset + i * 2 + 1]]);
                        parts.push(format!("{:x}", val));
                    }
                    parts.join(":")
                } else {
                    String::from("Invalid AAAA record")
                }
            }
            2 | 5 | 12 | 15 => {
                // NS, CNAME, PTR, MX - domain name
                match parse_dns_name(data, offset) {
                    Ok((domain, _)) => domain,
                    Err(_) => format!("<parse error at offset {}>", offset),
                }
            }
            _ => {
                // Other record types - show hex
                format!(
                    "0x{}",
                    data[offset..offset + data_length]
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect::<String>()
                )
            }
        };

        offset += data_length;

        answers.push(DnsResourceRecord {
            name,
            rtype,
            rclass,
            ttl,
            data: record_data,
        });
    }

    Ok(DnsMessage {
        transaction_id,
        flags,
        questions,
        answer_rrs,
        authority_rrs,
        additional_rrs,
        queries,
        answers,
        is_response,
        opcode,
        response_code,
    })
}

fn parse_dns_name(data: &[u8], mut offset: usize) -> Result<(String, usize)> {
    let mut name_parts = Vec::new();
    let mut jumped = false;
    let mut visited_offsets = std::collections::HashSet::new();

    loop {
        if offset >= data.len() {
            anyhow::bail!("DNS name parsing out of bounds");
        }

        // Prevent infinite loops from compression pointers
        if visited_offsets.contains(&offset) {
            anyhow::bail!("DNS compression loop detected");
        }
        visited_offsets.insert(offset);

        let length = data[offset] as usize;
        offset += 1;

        if length == 0 {
            // End of name
            break;
        } else if (length & 0xC0) == 0xC0 {
            // Compression pointer
            if offset >= data.len() {
                anyhow::bail!("DNS compression pointer out of bounds");
            }
            let pointer = u16::from_be_bytes([(length & 0x3F) as u8, data[offset]]) as usize;
            offset += 1;

            if !jumped {
                // Only jump once to avoid infinite loops (checked in else branch on re-entry)
                jumped = true;
                let _ = jumped;
                // Parse the compressed name using the simple parser
                match parse_dns_name_simple(data, pointer) {
                    Ok(compressed_name) => {
                        name_parts.push(compressed_name);
                        break;
                    }
                    Err(_) => {
                        // If compression parsing fails, try to continue with what we have
                        break;
                    }
                }
            } else {
                anyhow::bail!("DNS compression loop detected");
            }
        } else if length > 63 {
            // Invalid label length
            anyhow::bail!("Invalid DNS label length: {}", length);
        } else {
            // Normal label
            if offset + length > data.len() {
                anyhow::bail!("DNS label out of bounds");
            }
            let label = String::from_utf8_lossy(&data[offset..offset + length]);
            name_parts.push(label.to_string());
            offset += length;
        }
    }

    let name = if name_parts.is_empty() {
        String::from(".")
    } else {
        name_parts.join(".")
    };

    Ok((name, offset))
}

// Simplified DNS name parser for compression pointers (no loop detection)
fn parse_dns_name_simple(data: &[u8], mut offset: usize) -> Result<String> {
    let mut name_parts = Vec::new();
    let mut depth = 0;
    const MAX_DEPTH: usize = 10; // Prevent infinite recursion

    loop {
        if depth > MAX_DEPTH {
            anyhow::bail!("DNS name parsing depth exceeded");
        }
        depth += 1;

        if offset >= data.len() {
            anyhow::bail!("DNS name parsing out of bounds");
        }

        let length = data[offset] as usize;
        offset += 1;

        if length == 0 {
            break;
        } else if (length & 0xC0) == 0xC0 {
            // Compression pointer
            if offset >= data.len() {
                anyhow::bail!("DNS compression pointer out of bounds");
            }
            let pointer = u16::from_be_bytes([(length & 0x3F) as u8, data[offset]]) as usize;
            // Recursively parse from the pointer
            match parse_dns_name_simple(data, pointer) {
                Ok(compressed_name) => {
                    name_parts.push(compressed_name);
                    break;
                }
                Err(e) => return Err(e),
            }
        } else if length > 63 {
            anyhow::bail!("Invalid DNS label length: {}", length);
        } else {
            if offset + length > data.len() {
                anyhow::bail!("DNS label out of bounds");
            }
            let label = String::from_utf8_lossy(&data[offset..offset + length]);
            name_parts.push(label.to_string());
            offset += length;
        }
    }

    Ok(if name_parts.is_empty() {
        String::from(".")
    } else {
        name_parts.join(".")
    })
}
