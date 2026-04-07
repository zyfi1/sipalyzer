use super::sip_parser::ParsedSipMessage;
use super::{
    ApplicationLayer, EvidenceType, ExpertFinding, FindingCategory, FindingEvidence,
    FindingSeverity, PacketInfo, Protocol,
};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub struct InputSipDialog {
    pub call_id: String,
    pub messages: Vec<InputSipDialogMessage>,
    pub start_time: String,
    pub end_time: Option<String>,
}

pub struct InputSipDialogMessage {
    pub method_or_code: String,
    pub cseq: Option<String>,
    pub timestamp: String,
    pub packet_index: u64,
}

pub struct InputRtpStream {
    pub ssrc: u32,
    pub src_ip: String,
    pub src_port: u16,
    pub dst_ip: String,
    pub dst_port: u16,
    pub codec_name: String,
    pub packet_count: u64,
    pub lost_packets: u32,
    pub loss_percentage: f64,
    pub jitter: f64,
    pub mos_score: f64,
    pub first_packet_time: String,
    pub last_packet_time: String,
}

pub fn analyze(
    packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    rtp_streams: &[InputRtpStream],
) -> Vec<ExpertFinding> {
    let mut findings = Vec::new();
    check_sip_retransmissions(packets, &mut findings);
    check_invite_no_ack(packets, dialogs, &mut findings);
    check_bye_no_response(packets, dialogs, &mut findings);
    check_session_timer_expiry(packets, dialogs, &mut findings);
    check_unexpected_responses(packets, &mut findings);
    check_auth_failure_burst(packets, &mut findings);
    check_missing_sdp(packets, dialogs, &mut findings);
    check_rtp_quality_degraded(rtp_streams, &mut findings);
    check_rtp_timeout(packets, rtp_streams, &mut findings);
    check_one_way_rtp(packets, rtp_streams, dialogs, &mut findings);
    check_codec_mismatch(packets, dialogs, &mut findings);
    check_dtmf_mode_conflict(packets, dialogs, &mut findings);
    check_private_ip_in_sdp(packets, &mut findings);
    check_dscp_inconsistent(packets, rtp_streams, &mut findings);
    check_sip_alg_suspected(packets, &mut findings);
    check_fragmented_packets(packets, &mut findings);
    check_tls_downgrade(packets, &mut findings);
    check_registration_flood(packets, &mut findings);
    check_t38_switchover_failure(packets, dialogs, &mut findings);
    check_t38_retransmission(packets, &mut findings);

    findings.sort_by(|a, b| {
        severity_order(&a.severity)
            .cmp(&severity_order(&b.severity))
            .then_with(|| a.first_seen.cmp(&b.first_seen))
    });
    findings
}

fn severity_order(s: &FindingSeverity) -> u8 {
    match s {
        FindingSeverity::Critical => 0,
        FindingSeverity::Warning => 1,
        FindingSeverity::Info => 2,
    }
}

fn extract_sip(p: &PacketInfo) -> Option<&ParsedSipMessage> {
    p.decoded.as_ref().and_then(|d| match &d.application {
        ApplicationLayer::Sip(s) => Some(s),
        ApplicationLayer::SipOverWs { sip, .. } => Some(sip),
        _ => None,
    })
}

fn finding_id(rule_id: &str, key: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    format!("{}-{:x}", rule_id, hasher.finish())
}

fn is_private_ip_str(ip: &str) -> bool {
    if ip.starts_with("10.") || ip.starts_with("192.168.") {
        return true;
    }
    if ip.starts_with("172.") {
        if let Some(second) = ip.split('.').nth(1) {
            if let Ok(n) = second.parse::<u8>() {
                return (16..=31).contains(&n);
            }
        }
    }
    false
}

fn extract_ip_from_via(via: &str) -> Option<String> {
    let parts: Vec<&str> = via.split_whitespace().collect();
    if parts.len() >= 2 {
        let host_port = parts[1].split(';').next().unwrap_or(parts[1]);
        let host = host_port.split(':').next().unwrap_or(host_port);
        return Some(host.to_string());
    }
    None
}

fn extract_ip_from_contact(contact: &str) -> Option<String> {
    let uri_start = contact.find("sip:").or_else(|| contact.find("sips:"))?;
    let uri_part = &contact[uri_start..];
    let at_pos = uri_part.find('@')?;
    let host_part = &uri_part[at_pos + 1..];
    let host = host_part
        .split(|c: char| c == ':' || c == ';' || c == '>' || c.is_whitespace())
        .next()
        .unwrap_or(host_part);
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn cseq_method(cseq: &str) -> &str {
    cseq.split_whitespace().last().unwrap_or("")
}

// ── Rule 1: SIP retransmissions ──────────────────────────────────────────────

fn check_sip_retransmissions(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut groups: HashMap<(String, String, String, String), Vec<usize>> = HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        let method = match &sip.method {
            Some(m) => m.clone(),
            None => continue,
        };
        let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
        let cseq = sip.cseq.as_deref().unwrap_or("").to_string();
        if call_id.is_empty() || cseq.is_empty() {
            continue;
        }
        let key = (call_id, cseq, method, p.src_ip.to_string());
        groups.entry(key).or_default().push(idx);
    }

    for ((call_id, cseq, method, src_ip), indices) in &groups {
        let count = indices.len();
        if count <= 1 {
            continue;
        }
        let is_storm = count > 3;
        let severity = if is_storm {
            FindingSeverity::Warning
        } else {
            FindingSeverity::Info
        };
        let title = if is_storm {
            format!("SIP retransmission storm: {} {} ({}×)", method, cseq, count)
        } else {
            format!("SIP retransmission: {} {} ({}×)", method, cseq, count)
        };
        findings.push(ExpertFinding {
            id: finding_id(
                "sip-retransmission",
                &format!("{}:{}:{}:{}", call_id, cseq, method, src_ip),
            ),
            rule_id: "sip-retransmission".into(),
            severity,
            category: FindingCategory::Signaling,
            title,
            description: format!(
                "{} {} retransmitted {}× from {}",
                method, cseq, count, src_ip
            ),
            detail: None,
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::Packet,
                value: format!("{} packets", count),
                label: Some("Retransmitted packets".into()),
                packet_indices: indices.clone(),
            }],
            article_id: Some("sip-408-timeout".into()),
            related_call_id: Some(call_id.clone()),
            count: count as u32,
            first_seen: packets[indices[0]].timestamp.to_rfc3339(),
            last_seen: packets[*indices.last().unwrap()].timestamp.to_rfc3339(),
        });
    }
}

// ── Rule 2: INVITE without ACK ───────────────────────────────────────────────

fn check_invite_no_ack(
    _packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for dialog in dialogs {
        let mut invite_200_idx: Option<usize> = None;
        let mut invite_200_ts: Option<String> = None;
        let mut has_ack = false;

        for msg in &dialog.messages {
            let cm = msg.cseq.as_deref().map(cseq_method).unwrap_or("");
            if msg.method_or_code == "200" && cm == "INVITE" {
                invite_200_idx = Some(msg.packet_index as usize);
                invite_200_ts = Some(msg.timestamp.clone());
            }
            if msg.method_or_code == "ACK" {
                has_ack = true;
            }
        }

        if invite_200_idx.is_some() && !has_ack {
            let ts = invite_200_ts.unwrap_or_default();
            findings.push(ExpertFinding {
                id: finding_id("invite-no-ack", &dialog.call_id),
                rule_id: "invite-no-ack".into(),
                severity: FindingSeverity::Critical,
                category: FindingCategory::Signaling,
                title: "INVITE 200 OK without ACK".into(),
                description: format!(
                    "200 OK for INVITE received but no ACK followed (Call-ID: {})",
                    dialog.call_id
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::SipDialog,
                    value: dialog.call_id.clone(),
                    label: Some("Dialog missing ACK".into()),
                    packet_indices: invite_200_idx.into_iter().collect(),
                }],
                article_id: Some("reinvite-failures".into()),
                related_call_id: Some(dialog.call_id.clone()),
                count: 1,
                first_seen: ts.clone(),
                last_seen: ts,
            });
        }
    }
}

// ── Rule 3: BYE without response ─────────────────────────────────────────────

fn check_bye_no_response(
    _packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for dialog in dialogs {
        let mut bye_indices: Vec<usize> = Vec::new();
        let mut bye_cseqs: HashSet<String> = HashSet::new();
        let mut response_cseqs: HashSet<String> = HashSet::new();

        for msg in &dialog.messages {
            if msg.method_or_code == "BYE" {
                bye_indices.push(msg.packet_index as usize);
                if let Some(ref cs) = msg.cseq {
                    bye_cseqs.insert(cs.clone());
                }
            }
            if msg.method_or_code.parse::<u16>().is_ok() {
                if let Some(ref cs) = msg.cseq {
                    if cseq_method(cs) == "BYE" {
                        response_cseqs.insert(cs.clone());
                    }
                }
            }
        }

        let unanswered: Vec<&String> = bye_cseqs
            .iter()
            .filter(|cs| !response_cseqs.contains(*cs))
            .collect();
        if !unanswered.is_empty() {
            let ts = dialog.start_time.clone();
            let end = dialog.end_time.as_deref().unwrap_or(&ts).to_string();
            findings.push(ExpertFinding {
                id: finding_id("bye-no-response", &dialog.call_id),
                rule_id: "bye-no-response".into(),
                severity: FindingSeverity::Warning,
                category: FindingCategory::Signaling,
                title: "BYE without response".into(),
                description: format!(
                    "BYE sent but no final response received (Call-ID: {})",
                    dialog.call_id
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::SipDialog,
                    value: dialog.call_id.clone(),
                    label: Some("Unanswered BYE".into()),
                    packet_indices: bye_indices,
                }],
                article_id: Some("sip-481-does-not-exist".into()),
                related_call_id: Some(dialog.call_id.clone()),
                count: unanswered.len() as u32,
                first_seen: ts,
                last_seen: end,
            });
        }
    }
}

// ── Rule 4: Session timer without refresh ────────────────────────────────────

fn check_session_timer_expiry(
    packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    let mut session_timers: HashMap<String, (u64, usize, String)> = HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        if let Some(expires) = sip.headers.get("session-expires") {
            let secs: u64 = expires
                .split(';')
                .next()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
            if secs > 0 {
                let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
                if !call_id.is_empty() {
                    session_timers
                        .entry(call_id)
                        .or_insert((secs, idx, p.timestamp.to_rfc3339()));
                }
            }
        }
    }

    for dialog in dialogs {
        if let Some((expires_secs, pkt_idx, ref first_ts)) = session_timers.get(&dialog.call_id) {
            let has_refresh = dialog.messages.iter().enumerate().any(|(i, m)| {
                m.method_or_code == "UPDATE" || (m.method_or_code == "INVITE" && i > 0)
            });

            if !has_refresh {
                findings.push(ExpertFinding {
                    id: finding_id("session-timer-expiry", &dialog.call_id),
                    rule_id: "session-timer-expiry".into(),
                    severity: FindingSeverity::Warning,
                    category: FindingCategory::Signaling,
                    title: format!("Session timer ({}s) without refresh", expires_secs),
                    description: format!(
                        "Session-Expires: {}s set but no re-INVITE/UPDATE seen (Call-ID: {})",
                        expires_secs, dialog.call_id
                    ),
                    detail: None,
                    evidence: vec![FindingEvidence {
                        evidence_type: EvidenceType::Packet,
                        value: format!("Session-Expires: {}s", expires_secs),
                        label: Some("Session timer header".into()),
                        packet_indices: vec![*pkt_idx],
                    }],
                    article_id: Some("session-timer-expiry".into()),
                    related_call_id: Some(dialog.call_id.clone()),
                    count: 1,
                    first_seen: first_ts.clone(),
                    last_seen: dialog.end_time.as_deref().unwrap_or(first_ts).to_string(),
                });
            }
        }
    }
}

// ── Rule 5: Unexpected 5xx/6xx responses ─────────────────────────────────────

fn check_unexpected_responses(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        let code = match sip.response_code {
            Some(c) if (500..700).contains(&c) && c != 503 => c,
            _ => continue,
        };
        let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
        let method = sip.cseq.as_deref().map(cseq_method).unwrap_or("?");
        let reason = sip.response_text.as_deref().unwrap_or("");
        let severity = if code >= 600 {
            FindingSeverity::Warning
        } else {
            FindingSeverity::Critical
        };
        let article = match code {
            500 => "sip-500-server-error",
            501 => "sip-501-not-implemented",
            502 => "sip-502-bad-gateway",
            504 => "sip-504-timeout",
            600 => "sip-600-busy-everywhere",
            603 => "sip-603-decline",
            _ => "sip-server-errors",
        };
        let ts = p.timestamp.to_rfc3339();
        findings.push(ExpertFinding {
            id: finding_id(
                "unexpected-response",
                &format!("{}:{}:{}", call_id, code, idx),
            ),
            rule_id: "unexpected-response".into(),
            severity,
            category: FindingCategory::Signaling,
            title: format!("{} {} for {}", code, reason, method),
            description: format!(
                "Unexpected {} {} response for {} (Call-ID: {})",
                code, reason, method, call_id
            ),
            detail: None,
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::Packet,
                value: format!("{} {}", code, reason),
                label: Some("Response code".into()),
                packet_indices: vec![idx],
            }],
            article_id: Some(article.into()),
            related_call_id: if call_id.is_empty() {
                None
            } else {
                Some(call_id)
            },
            count: 1,
            first_seen: ts.clone(),
            last_seen: ts,
        });
    }
}

// ── Rule 6: Authentication failure burst ─────────────────────────────────────

fn check_auth_failure_burst(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut auth_failures: HashMap<String, Vec<(usize, chrono::DateTime<chrono::Utc>)>> =
        HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        match sip.response_code {
            Some(401) | Some(403) => {}
            _ => continue,
        }
        let from_uri = sip.from.as_deref().unwrap_or("unknown").to_string();
        auth_failures
            .entry(from_uri)
            .or_default()
            .push((idx, p.timestamp));
    }

    for (from_uri, events) in &auth_failures {
        let mut burst_start = 0;
        let mut max_burst: Vec<usize> = Vec::new();

        for i in 0..events.len() {
            while events[i]
                .1
                .signed_duration_since(events[burst_start].1)
                .num_seconds()
                > 60
            {
                burst_start += 1;
            }
            let window: Vec<usize> = events[burst_start..=i]
                .iter()
                .map(|(idx, _)| *idx)
                .collect();
            if window.len() > max_burst.len() {
                max_burst = window;
            }
        }

        if max_burst.len() >= 3 {
            let first_ts = packets[max_burst[0]].timestamp.to_rfc3339();
            let last_ts = packets[*max_burst.last().unwrap()].timestamp.to_rfc3339();
            findings.push(ExpertFinding {
                id: finding_id("auth-failure-burst", from_uri),
                rule_id: "auth-failure-burst".into(),
                severity: FindingSeverity::Warning,
                category: FindingCategory::Signaling,
                title: format!("Authentication failure burst ({}× in 60s)", max_burst.len()),
                description: format!(
                    "{}× 401/403 responses for {} within 60 seconds",
                    max_burst.len(),
                    from_uri
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::Packet,
                    value: format!("{} failures", max_burst.len()),
                    label: Some("Auth failure packets".into()),
                    packet_indices: max_burst.clone(),
                }],
                article_id: Some("reg-401-unauthorized".into()),
                related_call_id: None,
                count: max_burst.len() as u32,
                first_seen: first_ts,
                last_seen: last_ts,
            });
        }
    }
}

// ── Rule 7: Missing SDP in INVITE / 200 OK ──────────────────────────────────

fn check_missing_sdp(
    packets: &[PacketInfo],
    _dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };

        let is_invite = sip.method.as_deref() == Some("INVITE");
        let is_200_for_invite = sip.response_code == Some(200)
            && sip.cseq.as_deref().map(cseq_method) == Some("INVITE");

        if !is_invite && !is_200_for_invite {
            continue;
        }

        let has_sdp = sip
            .body
            .as_ref()
            .and_then(|b| b.sdp.as_ref())
            .map(|sdp| !sdp.media.is_empty())
            .unwrap_or(false);

        if !has_sdp {
            let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
            let label = if is_invite {
                "INVITE"
            } else {
                "200 OK (INVITE)"
            };
            let ts = p.timestamp.to_rfc3339();
            findings.push(ExpertFinding {
                id: finding_id("missing-sdp", &format!("{}:{}", call_id, idx)),
                rule_id: "missing-sdp".into(),
                severity: FindingSeverity::Info,
                category: FindingCategory::Signaling,
                title: format!("{} without SDP body", label),
                description: format!(
                    "{} has no SDP body — delayed offer or misconfiguration (Call-ID: {})",
                    label, call_id
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::Packet,
                    value: label.into(),
                    label: Some("Missing SDP".into()),
                    packet_indices: vec![idx],
                }],
                article_id: Some("codec-negotiation-failures".into()),
                related_call_id: if call_id.is_empty() {
                    None
                } else {
                    Some(call_id)
                },
                count: 1,
                first_seen: ts.clone(),
                last_seen: ts,
            });
        }
    }
}

// ── Rule 8: RTP quality degraded ─────────────────────────────────────────────

fn check_rtp_quality_degraded(rtp_streams: &[InputRtpStream], findings: &mut Vec<ExpertFinding>) {
    for stream in rtp_streams {
        let mut issues: Vec<String> = Vec::new();
        let mut article = "poor-mos-score";

        if stream.mos_score > 0.0 && stream.mos_score < 3.5 {
            issues.push(format!("MOS {:.1}", stream.mos_score));
            article = "poor-mos-score";
        }
        if stream.loss_percentage > 3.0 {
            issues.push(format!("{:.1}% loss", stream.loss_percentage));
            article = "packet-loss-impact";
        }
        if stream.jitter > 30.0 {
            issues.push(format!("{:.1}ms jitter", stream.jitter));
            article = "high-jitter";
        }

        if issues.is_empty() {
            continue;
        }

        let severity =
            if stream.mos_score > 0.0 && stream.mos_score < 2.5 || stream.loss_percentage > 10.0 {
                FindingSeverity::Critical
            } else {
                FindingSeverity::Warning
            };

        findings.push(ExpertFinding {
            id: finding_id("rtp-quality-degraded", &format!("{}", stream.ssrc)),
            rule_id: "rtp-quality-degraded".into(),
            severity,
            category: FindingCategory::Media,
            title: format!("RTP quality degraded: {}", issues.join(", ")),
            description: format!(
                "Stream SSRC 0x{:08X} ({}:{} → {}:{}) — {}",
                stream.ssrc,
                stream.src_ip,
                stream.src_port,
                stream.dst_ip,
                stream.dst_port,
                issues.join(", ")
            ),
            detail: Some(format!(
                "MOS: {:.2}, Jitter: {:.1}ms, Loss: {:.2}%, Packets: {}",
                stream.mos_score, stream.jitter, stream.loss_percentage, stream.packet_count
            )),
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::RtpStream,
                value: format!("0x{:08X}", stream.ssrc),
                label: Some("Degraded stream".into()),
                packet_indices: vec![],
            }],
            article_id: Some(article.into()),
            related_call_id: None,
            count: 1,
            first_seen: stream.first_packet_time.clone(),
            last_seen: stream.last_packet_time.clone(),
        });
    }
}

// ── Rule 9: RTP timeout (gap > 5s) ──────────────────────────────────────────

fn check_rtp_timeout(
    packets: &[PacketInfo],
    _rtp_streams: &[InputRtpStream],
    findings: &mut Vec<ExpertFinding>,
) {
    let mut ssrc_packets: HashMap<u32, Vec<(usize, chrono::DateTime<chrono::Utc>)>> =
        HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let rtp = match p.decoded.as_ref().map(|d| &d.application) {
            Some(ApplicationLayer::Rtp(h)) | Some(ApplicationLayer::Srtp(h)) => h,
            _ => continue,
        };
        ssrc_packets
            .entry(rtp.ssrc)
            .or_default()
            .push((idx, p.timestamp));
    }

    for (ssrc, pkt_list) in &ssrc_packets {
        if pkt_list.len() < 2 {
            continue;
        }
        for window in pkt_list.windows(2) {
            let gap = window[1].1.signed_duration_since(window[0].1).num_seconds();
            if gap > 5 {
                findings.push(ExpertFinding {
                    id: finding_id("rtp-timeout", &format!("{}:{}", ssrc, window[0].0)),
                    rule_id: "rtp-timeout".into(),
                    severity: FindingSeverity::Critical,
                    category: FindingCategory::Media,
                    title: format!("RTP timeout: {}s gap in stream 0x{:08X}", gap, ssrc),
                    description: format!(
                        "{}s gap between RTP packets in stream SSRC 0x{:08X}",
                        gap, ssrc
                    ),
                    detail: None,
                    evidence: vec![FindingEvidence {
                        evidence_type: EvidenceType::RtpStream,
                        value: format!("{}s gap", gap),
                        label: Some("RTP gap".into()),
                        packet_indices: vec![window[0].0, window[1].0],
                    }],
                    article_id: Some("no-audio".into()),
                    related_call_id: None,
                    count: 1,
                    first_seen: window[0].1.to_rfc3339(),
                    last_seen: window[1].1.to_rfc3339(),
                });
                break;
            }
        }
    }
}

// ── Rule 10: One-way RTP ─────────────────────────────────────────────────────

fn check_one_way_rtp(
    _packets: &[PacketInfo],
    rtp_streams: &[InputRtpStream],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    if rtp_streams.is_empty() || dialogs.is_empty() {
        return;
    }

    let mut forward_flows: HashSet<(String, String)> = HashSet::new();
    for s in rtp_streams {
        forward_flows.insert((
            format!("{}:{}", s.src_ip, s.src_port),
            format!("{}:{}", s.dst_ip, s.dst_port),
        ));
    }

    for s in rtp_streams {
        let reverse = (
            format!("{}:{}", s.dst_ip, s.dst_port),
            format!("{}:{}", s.src_ip, s.src_port),
        );
        if !forward_flows.contains(&reverse) && s.packet_count > 10 {
            findings.push(ExpertFinding {
                id: finding_id("one-way-rtp", &format!("{}", s.ssrc)),
                rule_id: "one-way-rtp".into(),
                severity: FindingSeverity::Critical,
                category: FindingCategory::Media,
                title: format!(
                    "One-way RTP: {}:{} → {}:{}",
                    s.src_ip, s.src_port, s.dst_ip, s.dst_port
                ),
                description: format!(
                    "RTP flows only from {}:{} to {}:{} — no return stream detected",
                    s.src_ip, s.src_port, s.dst_ip, s.dst_port
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::RtpStream,
                    value: format!("0x{:08X}", s.ssrc),
                    label: Some("One-way stream".into()),
                    packet_indices: vec![],
                }],
                article_id: Some("one-way-audio".into()),
                related_call_id: None,
                count: 1,
                first_seen: s.first_packet_time.clone(),
                last_seen: s.last_packet_time.clone(),
            });
        }
    }
}

// ── Rule 11: Codec mismatch ─────────────────────────────────────────────────

fn check_codec_mismatch(
    packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for dialog in dialogs {
        let mut sdp_codec_sets: Vec<(usize, HashSet<String>)> = Vec::new();

        for msg in &dialog.messages {
            let pkt_idx = msg.packet_index as usize;
            if pkt_idx >= packets.len() {
                continue;
            }
            if let Some(sip) = extract_sip(&packets[pkt_idx]) {
                if let Some(ref body) = sip.body {
                    if let Some(ref sdp) = body.sdp {
                        let mut codecs = HashSet::new();
                        for media in &sdp.media {
                            if media.media_type == "audio" {
                                for attr in &media.attributes {
                                    if let Some(rest) = attr.strip_prefix("rtpmap:") {
                                        if let Some(codec) = rest.split_whitespace().nth(1) {
                                            let name = codec.split('/').next().unwrap_or(codec);
                                            codecs.insert(name.to_uppercase());
                                        }
                                    }
                                }
                                for pt in &media.payload_types {
                                    codecs.insert(
                                        super::rtp_analyzer::get_codec_name(*pt).to_uppercase(),
                                    );
                                }
                            }
                        }
                        if !codecs.is_empty() {
                            sdp_codec_sets.push((pkt_idx, codecs));
                        }
                    }
                }
            }
        }

        if sdp_codec_sets.len() >= 2 {
            let (offer_idx, ref offer) = sdp_codec_sets[0];
            let (answer_idx, ref answer) = sdp_codec_sets[1];
            let common: HashSet<_> = offer.intersection(answer).collect();

            if common.is_empty() {
                findings.push(ExpertFinding {
                    id: finding_id("codec-mismatch", &dialog.call_id),
                    rule_id: "codec-mismatch".into(),
                    severity: FindingSeverity::Critical,
                    category: FindingCategory::Media,
                    title: "Codec mismatch: no common codecs".into(),
                    description: format!(
                        "SDP offer and answer share no common audio codecs (Call-ID: {})",
                        dialog.call_id
                    ),
                    detail: Some(format!(
                        "Offer: [{}] / Answer: [{}]",
                        offer.iter().cloned().collect::<Vec<_>>().join(", "),
                        answer.iter().cloned().collect::<Vec<_>>().join(", ")
                    )),
                    evidence: vec![FindingEvidence {
                        evidence_type: EvidenceType::Packet,
                        value: "No common codecs".into(),
                        label: Some("Codec negotiation".into()),
                        packet_indices: vec![offer_idx, answer_idx],
                    }],
                    article_id: Some("codec-negotiation-failures".into()),
                    related_call_id: Some(dialog.call_id.clone()),
                    count: 1,
                    first_seen: packets[offer_idx].timestamp.to_rfc3339(),
                    last_seen: packets[answer_idx].timestamp.to_rfc3339(),
                });
            }
        }
    }
}

// ── Rule 12: DTMF mode conflict ─────────────────────────────────────────────

fn check_dtmf_mode_conflict(
    packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for dialog in dialogs {
        let mut has_rfc2833 = false;
        let mut has_sip_info_dtmf = false;
        let mut evidence_indices: Vec<usize> = Vec::new();

        for msg in &dialog.messages {
            let pkt_idx = msg.packet_index as usize;
            if pkt_idx >= packets.len() {
                continue;
            }
            if let Some(sip) = extract_sip(&packets[pkt_idx]) {
                if let Some(ref body) = sip.body {
                    if let Some(ref sdp) = body.sdp {
                        for media in &sdp.media {
                            if media
                                .attributes
                                .iter()
                                .any(|a| a.contains("telephone-event"))
                            {
                                has_rfc2833 = true;
                                evidence_indices.push(pkt_idx);
                            }
                        }
                    }
                }
                if sip.method.as_deref() == Some("INFO") {
                    if let Some(ref ct) = sip.content_type {
                        if ct.contains("dtmf") || ct.contains("dtmf-relay") {
                            has_sip_info_dtmf = true;
                            evidence_indices.push(pkt_idx);
                        }
                    }
                }
            }
        }

        if has_rfc2833 && has_sip_info_dtmf {
            findings.push(ExpertFinding {
                id: finding_id("dtmf-mode-conflict", &dialog.call_id),
                rule_id: "dtmf-mode-conflict".into(),
                severity: FindingSeverity::Warning,
                category: FindingCategory::Media,
                title: "DTMF mode conflict: RFC 2833 + SIP INFO".into(),
                description: format!(
                    "Both RFC 2833 telephone-event and SIP INFO DTMF used in same dialog (Call-ID: {})",
                    dialog.call_id
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::SipDialog,
                    value: dialog.call_id.clone(),
                    label: Some("Mixed DTMF modes".into()),
                    packet_indices: evidence_indices,
                }],
                article_id: Some("dtmf-issues".into()),
                related_call_id: Some(dialog.call_id.clone()),
                count: 1,
                first_seen: dialog.start_time.clone(),
                last_seen: dialog
                    .end_time
                    .as_deref()
                    .unwrap_or(&dialog.start_time)
                    .to_string(),
            });
        }
    }
}

// ── Rule 13: Private IP in SDP ───────────────────────────────────────────────

fn check_private_ip_in_sdp(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        let sdp = match sip.body.as_ref().and_then(|b| b.sdp.as_ref()) {
            Some(s) => s,
            None => continue,
        };

        let sdp_ip = sdp
            .connection
            .as_ref()
            .and_then(|c| c.split_whitespace().last())
            .unwrap_or("");

        if !is_private_ip_str(sdp_ip) {
            continue;
        }

        let via_ip = sip
            .via
            .first()
            .and_then(|v| extract_ip_from_via(v))
            .unwrap_or_default();
        let contact_ip = sip
            .contact
            .as_deref()
            .and_then(extract_ip_from_contact)
            .unwrap_or_default();

        let has_public = (!via_ip.is_empty() && !is_private_ip_str(&via_ip))
            || (!contact_ip.is_empty() && !is_private_ip_str(&contact_ip));

        if has_public {
            let call_id = sip.call_id.as_deref().unwrap_or("").to_string();
            let ts = p.timestamp.to_rfc3339();
            findings.push(ExpertFinding {
                id: finding_id("private-ip-in-sdp", &format!("{}:{}", call_id, idx)),
                rule_id: "private-ip-in-sdp".into(),
                severity: FindingSeverity::Warning,
                category: FindingCategory::Network,
                title: format!("Private IP {} in SDP with public signaling", sdp_ip),
                description: format!(
                    "SDP connection address {} is RFC 1918 while Via/Contact uses public IP",
                    sdp_ip
                ),
                detail: Some(format!("Via: {}, Contact: {}", via_ip, contact_ip)),
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::Packet,
                    value: format!("c=IN IP4 {}", sdp_ip),
                    label: Some("Private SDP address".into()),
                    packet_indices: vec![idx],
                }],
                article_id: Some("nat-registration-issues".into()),
                related_call_id: if call_id.is_empty() {
                    None
                } else {
                    Some(call_id)
                },
                count: 1,
                first_seen: ts.clone(),
                last_seen: ts,
            });
        }
    }
}

// ── Rule 14: DSCP inconsistent ───────────────────────────────────────────────

fn check_dscp_inconsistent(
    packets: &[PacketInfo],
    _rtp_streams: &[InputRtpStream],
    findings: &mut Vec<ExpertFinding>,
) {
    let mut ssrc_dscp: HashMap<u32, HashMap<u8, Vec<usize>>> = HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let rtp = match p.decoded.as_ref().map(|d| &d.application) {
            Some(ApplicationLayer::Rtp(h)) | Some(ApplicationLayer::Srtp(h)) => h,
            _ => continue,
        };
        let dscp = p
            .decoded
            .as_ref()
            .and_then(|d| d.ip.as_ref())
            .map(|ip| ip.tos >> 2)
            .unwrap_or(0);
        ssrc_dscp
            .entry(rtp.ssrc)
            .or_default()
            .entry(dscp)
            .or_default()
            .push(idx);
    }

    for (ssrc, dscp_map) in &ssrc_dscp {
        if dscp_map.len() <= 1 {
            continue;
        }
        let dscp_values: Vec<String> = dscp_map.keys().map(|d| format!("{}", d)).collect();
        let all_indices: Vec<usize> = dscp_map.values().flat_map(|v| v.iter().copied()).collect();
        let first_idx = all_indices.iter().copied().min().unwrap_or(0);
        let last_idx = all_indices.iter().copied().max().unwrap_or(0);

        findings.push(ExpertFinding {
            id: finding_id("dscp-inconsistent", &format!("{}", ssrc)),
            rule_id: "dscp-inconsistent".into(),
            severity: FindingSeverity::Info,
            category: FindingCategory::Network,
            title: format!("Inconsistent DSCP marking on stream 0x{:08X}", ssrc),
            description: format!(
                "RTP stream SSRC 0x{:08X} has multiple DSCP values: [{}]",
                ssrc,
                dscp_values.join(", ")
            ),
            detail: None,
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::RtpStream,
                value: dscp_values.join(", "),
                label: Some("DSCP values".into()),
                packet_indices: all_indices.into_iter().take(10).collect(),
            }],
            article_id: Some("qos-dscp-marking".into()),
            related_call_id: None,
            count: dscp_map.len() as u32,
            first_seen: packets[first_idx].timestamp.to_rfc3339(),
            last_seen: packets[last_idx].timestamp.to_rfc3339(),
        });
    }
}

// ── Rule 15: SIP ALG suspected ───────────────────────────────────────────────

fn check_sip_alg_suspected(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut call_data: HashMap<String, Vec<(usize, bool, Option<String>, Option<String>)>> =
        HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        let call_id = match sip.call_id.as_deref() {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => continue,
        };
        let is_request = sip.method.is_some();
        let contact_ip = sip.contact.as_deref().and_then(extract_ip_from_contact);
        let via_ip = sip.via.first().and_then(|v| extract_ip_from_via(v));
        call_data
            .entry(call_id)
            .or_default()
            .push((idx, is_request, contact_ip, via_ip));
    }

    for (call_id, msgs) in &call_data {
        let requests: Vec<_> = msgs.iter().filter(|(_, is_req, _, _)| *is_req).collect();
        let responses: Vec<_> = msgs.iter().filter(|(_, is_req, _, _)| !*is_req).collect();

        if requests.is_empty() || responses.is_empty() {
            continue;
        }

        let mut found = false;
        for req in &requests {
            if found {
                break;
            }
            for resp in &responses {
                if let (Some(ref req_contact), Some(ref resp_contact)) = (&req.2, &resp.2) {
                    if req_contact != resp_contact
                        && !req_contact.is_empty()
                        && !resp_contact.is_empty()
                    {
                        let ts = packets[req.0].timestamp.to_rfc3339();
                        findings.push(ExpertFinding {
                            id: finding_id("sip-alg-suspected", call_id),
                            rule_id: "sip-alg-suspected".into(),
                            severity: FindingSeverity::Warning,
                            category: FindingCategory::Network,
                            title: "SIP ALG suspected: Contact IP mismatch".into(),
                            description: format!(
                                "Contact IP differs between request ({}) and response ({}) — possible SIP ALG rewriting",
                                req_contact, resp_contact
                            ),
                            detail: None,
                            evidence: vec![FindingEvidence {
                                evidence_type: EvidenceType::Packet,
                                value: format!("{} vs {}", req_contact, resp_contact),
                                label: Some("Contact IP mismatch".into()),
                                packet_indices: vec![req.0, resp.0],
                            }],
                            article_id: Some("sip-alg-problems".into()),
                            related_call_id: Some(call_id.clone()),
                            count: 1,
                            first_seen: ts,
                            last_seen: packets[resp.0].timestamp.to_rfc3339(),
                        });
                        found = true;
                        break;
                    }
                }
            }
        }
    }
}

// ── Rule 16: Fragmented packets ──────────────────────────────────────────────

fn check_fragmented_packets(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut frag_indices: Vec<usize> = Vec::new();

    for (idx, p) in packets.iter().enumerate() {
        let ip = match p.decoded.as_ref().and_then(|d| d.ip.as_ref()) {
            Some(ip) => ip,
            None => continue,
        };
        let is_fragmented = (ip.flags & 0x01) != 0 || ip.fragment_offset > 0;
        if is_fragmented && matches!(p.protocol, Protocol::RTP | Protocol::SIP | Protocol::SRTP) {
            frag_indices.push(idx);
        }
    }

    if !frag_indices.is_empty() {
        findings.push(ExpertFinding {
            id: finding_id("fragmented-packets", "all"),
            rule_id: "fragmented-packets".into(),
            severity: FindingSeverity::Info,
            category: FindingCategory::Network,
            title: format!("{} fragmented SIP/RTP packets", frag_indices.len()),
            description: format!(
                "{} SIP/RTP packets show IP fragmentation — may indicate MTU issues",
                frag_indices.len()
            ),
            detail: None,
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::Packet,
                value: format!("{} fragments", frag_indices.len()),
                label: Some("Fragmented packets".into()),
                packet_indices: frag_indices.iter().copied().take(20).collect(),
            }],
            article_id: Some("mtu-fragmentation".into()),
            related_call_id: None,
            count: frag_indices.len() as u32,
            first_seen: packets[frag_indices[0]].timestamp.to_rfc3339(),
            last_seen: packets[*frag_indices.last().unwrap()]
                .timestamp
                .to_rfc3339(),
        });
    }
}

// ── Rule 17: TLS / SRTP downgrade ────────────────────────────────────────────

fn check_tls_downgrade(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut flow_types: HashMap<String, (Option<usize>, Option<usize>)> = HashMap::new();

    for (idx, p) in packets.iter().enumerate() {
        let flow = format!("{}:{}-{}:{}", p.src_ip, p.src_port, p.dst_ip, p.dst_port);
        match p.decoded.as_ref().map(|d| &d.application) {
            Some(ApplicationLayer::Srtp(_)) => {
                let entry = flow_types.entry(flow).or_insert((None, None));
                if entry.0.is_none() {
                    entry.0 = Some(idx);
                }
            }
            Some(ApplicationLayer::Rtp(_)) => {
                let entry = flow_types.entry(flow).or_insert((None, None));
                if entry.1.is_none() {
                    entry.1 = Some(idx);
                }
            }
            _ => {}
        }
    }

    for (flow, (srtp_first, rtp_first)) in &flow_types {
        if let (Some(srtp_idx), Some(rtp_idx)) = (srtp_first, rtp_first) {
            if srtp_idx < rtp_idx {
                findings.push(ExpertFinding {
                    id: finding_id("tls-downgrade", flow),
                    rule_id: "tls-downgrade".into(),
                    severity: FindingSeverity::Warning,
                    category: FindingCategory::Security,
                    title: "SRTP to RTP downgrade detected".into(),
                    description: format!(
                        "SRTP packets followed by unencrypted RTP on flow {}",
                        flow
                    ),
                    detail: None,
                    evidence: vec![FindingEvidence {
                        evidence_type: EvidenceType::Packet,
                        value: "SRTP→RTP".into(),
                        label: Some("Security downgrade".into()),
                        packet_indices: vec![*srtp_idx, *rtp_idx],
                    }],
                    article_id: Some("srtp-key-negotiation".into()),
                    related_call_id: None,
                    count: 1,
                    first_seen: packets[*srtp_idx].timestamp.to_rfc3339(),
                    last_seen: packets[*rtp_idx].timestamp.to_rfc3339(),
                });
            }
        }
    }
}

// ── Rule 18: Registration flood ──────────────────────────────────────────────

fn check_registration_flood(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut registers: HashMap<String, Vec<(usize, chrono::DateTime<chrono::Utc>)>> =
        HashMap::new();
    let mut ok_sources: HashSet<String> = HashSet::new();

    for (idx, p) in packets.iter().enumerate() {
        let sip = match extract_sip(p) {
            Some(s) => s,
            None => continue,
        };
        if sip.method.as_deref() == Some("REGISTER") {
            registers
                .entry(p.src_ip.to_string())
                .or_default()
                .push((idx, p.timestamp));
        }
        if sip.response_code == Some(200)
            && sip.cseq.as_deref().map(cseq_method) == Some("REGISTER")
        {
            ok_sources.insert(p.dst_ip.to_string());
        }
    }

    for (src_ip, regs) in &registers {
        if ok_sources.contains(src_ip) {
            continue;
        }
        let mut start = 0;
        let mut max_burst: Vec<usize> = Vec::new();

        for i in 0..regs.len() {
            while regs[i].1.signed_duration_since(regs[start].1).num_seconds() > 30 {
                start += 1;
            }
            let window: Vec<usize> = regs[start..=i].iter().map(|(idx, _)| *idx).collect();
            if window.len() > max_burst.len() {
                max_burst = window;
            }
        }

        if max_burst.len() > 10 {
            let first_ts = packets[max_burst[0]].timestamp.to_rfc3339();
            let last_ts = packets[*max_burst.last().unwrap()].timestamp.to_rfc3339();
            findings.push(ExpertFinding {
                id: finding_id("registration-flood", src_ip),
                rule_id: "registration-flood".into(),
                severity: FindingSeverity::Warning,
                category: FindingCategory::Security,
                title: format!(
                    "Registration flood: {} REGISTERs in 30s from {}",
                    max_burst.len(),
                    src_ip
                ),
                description: format!(
                    "{}× REGISTER from {} in 30 seconds without 200 OK response",
                    max_burst.len(),
                    src_ip
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::Packet,
                    value: format!("{} REGISTER requests", max_burst.len()),
                    label: Some("REGISTER flood".into()),
                    packet_indices: max_burst.clone(),
                }],
                article_id: Some("sip-alg-problems".into()),
                related_call_id: None,
                count: max_burst.len() as u32,
                first_seen: first_ts,
                last_seen: last_ts,
            });
        }
    }
}

// ── Rule 19: T.38 switchover failure ─────────────────────────────────────────

fn check_t38_switchover_failure(
    packets: &[PacketInfo],
    dialogs: &[InputSipDialog],
    findings: &mut Vec<ExpertFinding>,
) {
    for dialog in dialogs {
        let mut t38_invite: Option<(usize, String)> = None;
        let mut rejection_idx: Option<usize> = None;

        for msg in &dialog.messages {
            let pkt_idx = msg.packet_index as usize;
            if pkt_idx >= packets.len() {
                continue;
            }

            if msg.method_or_code == "INVITE" {
                if let Some(sip) = extract_sip(&packets[pkt_idx]) {
                    if let Some(ref body) = sip.body {
                        if let Some(ref sdp) = body.sdp {
                            let has_t38 = sdp.media.iter().any(|m| {
                                m.media_type == "image"
                                    || m.protocol
                                        .as_deref()
                                        .map(|p| p.to_lowercase().contains("udptl"))
                                        .unwrap_or(false)
                            });
                            if has_t38 {
                                t38_invite = Some((pkt_idx, msg.cseq.clone().unwrap_or_default()));
                            }
                        }
                    }
                }
            }

            if let Some((_, ref invite_cseq)) = t38_invite {
                if let Ok(code) = msg.method_or_code.parse::<u16>() {
                    if (code == 488 || code == 606)
                        && msg.cseq.as_deref() == Some(invite_cseq.as_str())
                    {
                        rejection_idx = Some(pkt_idx);
                    }
                }
            }
        }

        if let (Some((invite_idx, _)), Some(reject_idx)) = (t38_invite, rejection_idx) {
            findings.push(ExpertFinding {
                id: finding_id("t38-switchover-failure", &dialog.call_id),
                rule_id: "t38-switchover-failure".into(),
                severity: FindingSeverity::Critical,
                category: FindingCategory::Fax,
                title: "T.38 switchover rejected".into(),
                description: format!(
                    "re-INVITE with T.38 SDP was rejected with 488/606 (Call-ID: {})",
                    dialog.call_id
                ),
                detail: None,
                evidence: vec![FindingEvidence {
                    evidence_type: EvidenceType::Packet,
                    value: "T.38 re-INVITE rejected".into(),
                    label: Some("Fax switchover failure".into()),
                    packet_indices: vec![invite_idx, reject_idx],
                }],
                article_id: Some("t38-reinvite-switchover".into()),
                related_call_id: Some(dialog.call_id.clone()),
                count: 1,
                first_seen: packets[invite_idx].timestamp.to_rfc3339(),
                last_seen: packets[reject_idx].timestamp.to_rfc3339(),
            });
        }
    }
}

// ── Rule 20: T.38 UDPTL retransmission ───────────────────────────────────────

fn check_t38_retransmission(packets: &[PacketInfo], findings: &mut Vec<ExpertFinding>) {
    let mut high_redundancy_indices: Vec<usize> = Vec::new();

    for (idx, p) in packets.iter().enumerate() {
        let t38 = match p.decoded.as_ref().map(|d| &d.application) {
            Some(ApplicationLayer::T38(t)) => t,
            _ => continue,
        };
        if t38.udptl_type > 1 {
            high_redundancy_indices.push(idx);
        }
    }

    if !high_redundancy_indices.is_empty() {
        findings.push(ExpertFinding {
            id: finding_id("t38-retransmission", "all"),
            rule_id: "t38-retransmission".into(),
            severity: FindingSeverity::Warning,
            category: FindingCategory::Fax,
            title: format!(
                "{} T.38 UDPTL packets with high redundancy",
                high_redundancy_indices.len()
            ),
            description: format!(
                "{} UDPTL packets show elevated redundancy level, indicating retransmission or lossy link",
                high_redundancy_indices.len()
            ),
            detail: None,
            evidence: vec![FindingEvidence {
                evidence_type: EvidenceType::Packet,
                value: format!("{} high-redundancy packets", high_redundancy_indices.len()),
                label: Some("T.38 redundancy".into()),
                packet_indices: high_redundancy_indices.iter().copied().take(20).collect(),
            }],
            article_id: Some("t38-network-requirements".into()),
            related_call_id: None,
            count: high_redundancy_indices.len() as u32,
            first_seen: packets[high_redundancy_indices[0]].timestamp.to_rfc3339(),
            last_seen: packets[*high_redundancy_indices.last().unwrap()]
                .timestamp
                .to_rfc3339(),
        });
    }
}
