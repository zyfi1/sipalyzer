//! Compatibility layer bridging existing SipMessage/SipUri types with rsip types.
//! Allows incremental migration from the hand-rolled SIP stack to rsipstack.

use crate::sip::stack::SipMessage;

/// Convert our SipMessage to an rsip::SipMessage for interop.
/// Uses our serializer then rsip's parser so we don't depend on rsip's FromStr for Method/Uri/Header.
pub fn to_rsip(msg: &SipMessage) -> Result<rsip::SipMessage, String> {
    let bytes = msg.to_bytes().map_err(|e| e.to_string())?;
    parse_rsip(&bytes)
}

/// Convert an rsip::SipMessage back to our SipMessage for backward compatibility.
pub fn from_rsip(msg: &rsip::SipMessage) -> SipMessage {
    match msg {
        rsip::SipMessage::Request(req) => {
            let mut sip_msg = SipMessage::new_request(
                &req.method.to_string(),
                &req.uri.to_string(),
            );
            for header in req.headers.iter() {
                let s = header.to_string();
                if let Some((name, value)) = s.split_once(':') {
                    sip_msg.add_header(name.trim(), value.trim());
                }
            }
            if !req.body.is_empty() {
                sip_msg.body = Some(String::from_utf8_lossy(&req.body).into_owned());
            }
            sip_msg
        }
        rsip::SipMessage::Response(res) => {
            let code = res.status_code.code();
            // StatusCode Display is "CODE Reason" (e.g. "200 OK"); extract reason after first space.
            let status_str = res.status_code.to_string();
            let reason = status_str
                .split_once(' ')
                .map(|(_, r)| r)
                .unwrap_or("");
            let mut sip_msg = SipMessage::new_response(code, reason);
            for header in res.headers.iter() {
                let s = header.to_string();
                if let Some((name, value)) = s.split_once(':') {
                    sip_msg.add_header(name.trim(), value.trim());
                }
            }
            if !res.body.is_empty() {
                sip_msg.body = Some(String::from_utf8_lossy(&res.body).into_owned());
            }
            sip_msg
        }
    }
}

/// Parse raw bytes using rsip's parser (more robust than our hand-rolled one).
pub fn parse_rsip(data: &[u8]) -> Result<rsip::SipMessage, String> {
    rsip::SipMessage::try_from(data)
        .map_err(|e| format!("rsip parse error: {}", e))
}

/// Serialize an rsip message to bytes.
pub fn serialize_rsip(msg: &rsip::SipMessage) -> Vec<u8> {
    msg.to_string().into_bytes()
}
