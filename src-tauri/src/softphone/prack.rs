//! 100rel / PRACK support (RFC 3262).
//!
//! When we receive a provisional response (1xx) with Require: 100rel and an RSeq header,
//! we must send a PRACK to acknowledge it. The PRACK references the provisional via RAck.

use crate::core::user_agent;
use crate::sip::stack::{generate_tag, SipMessage};
use crate::sip::transport::Transport;

/// Check if a response requires PRACK (has Require: 100rel and RSeq header).
pub fn needs_prack(response: &SipMessage) -> bool {
    let code = response.status_code.unwrap_or(0);
    if code < 101 || code >= 200 {
        return false;
    }
    let require = response
        .get_header("Require")
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let has_100rel = require.contains("100rel");
    let has_rseq = response.get_header("RSeq").is_some();
    has_100rel && has_rseq
}

/// Build and send a PRACK for a reliable provisional response.
/// `cseq` is the CSeq number to use for this PRACK in the dialog.
pub fn send_prack(
    transport: &Transport,
    response: &SipMessage,
    request_uri: &str,
    from_header: &str,
    to_header: &str,
    call_id: &str,
    local_ip: &str,
    local_port: u16,
    cseq: u32,
    via_transport: &str,
) -> Result<(), String> {
    let rseq = response
        .get_header("RSeq")
        .and_then(|s| s.trim().parse::<u32>().ok())
        .ok_or("Missing or invalid RSeq in provisional response")?;

    let original_cseq = response.get_header("CSeq").cloned().unwrap_or_default();
    // CSeq value looks like "1 INVITE" — extract the number and method
    let cseq_parts: Vec<&str> = original_cseq.trim().split_whitespace().collect();
    let original_cseq_num: u32 = cseq_parts.first().and_then(|s| s.parse().ok()).unwrap_or(1);
    let original_method = cseq_parts.get(1).unwrap_or(&"INVITE");

    // RAck: <RSeq> <CSeq-number> <method>
    let rack = format!("{} {} {}", rseq, original_cseq_num, original_method);

    let branch = format!("z9hG4bK{}", generate_tag());
    let mut prack = SipMessage::new_request("PRACK", request_uri);
    prack.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, local_port, branch
        ),
    );
    prack.add_header("Max-Forwards", "70");
    prack.add_header("From", from_header);
    prack.add_header("To", to_header);
    prack.add_header("Call-ID", call_id);
    prack.add_header("CSeq", &format!("{} PRACK", cseq));
    prack.add_header("RAck", &rack);
    prack.add_header("User-Agent", &user_agent::get_effective_user_agent());

    let prack_bytes = prack.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&prack_bytes).map_err(|e| e.to_string())?;
    super::sip_log::log_bytes(call_id, "send", &prack_bytes);

    tracing::info!("Sent PRACK for call_id={}, RAck={}", call_id, rack);
    Ok(())
}
