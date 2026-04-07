//! SIP PUBLISH for presence (RFC 3903 + RFC 3856).
//!
//! Advertises our own presence state (online, busy, away, etc.) to the PBX/registrar.

use std::time::Duration;

use crate::core::database::Database;
use crate::core::user_agent;
use crate::sip::auth;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::Transport;
use crate::sip::uri::SipUri;

/// Presence states per RFC 3863 PIDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresenceState {
    Open,   // Available
    Closed, // Offline / DND
    Busy,
    Away,
}

impl PresenceState {
    fn basic(&self) -> &'static str {
        match self {
            PresenceState::Open | PresenceState::Away => "open",
            PresenceState::Closed | PresenceState::Busy => "closed",
        }
    }

    fn note(&self) -> &'static str {
        match self {
            PresenceState::Open => "Available",
            PresenceState::Closed => "Offline",
            PresenceState::Busy => "Busy",
            PresenceState::Away => "Away",
        }
    }
}

/// Build PIDF XML body per RFC 3863.
fn build_pidf(entity_uri: &str, state: PresenceState) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="{entity}">
  <tuple id="sipalyzer">
    <status>
      <basic>{basic}</basic>
    </status>
    <note>{note}</note>
  </tuple>
</presence>"#,
        entity = entity_uri,
        basic = state.basic(),
        note = state.note(),
    )
}

/// Publish our presence state to the registrar. Returns the SIP-ETag for refresh/removal.
pub fn publish_presence(
    registrar_id: &str,
    state: PresenceState,
    sip_if_match: Option<&str>,
    expires: u32,
) -> Result<Option<String>, String> {
    let registrars = Database::load_registrars().map_err(|e| e.to_string())?;
    let config = registrars
        .iter()
        .find(|r| r.id == registrar_id)
        .ok_or_else(|| "Registrar not found".to_string())?
        .clone();

    let local_port = config.local_port.unwrap_or(5060);
    let registrar_uri = SipUri::parse(&config.domain).map_err(|e| format!("Bad domain: {}", e))?;
    let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
    let registrar_host = registrar_uri.host_for_resolution();

    let mut transport = Transport::new(
        config.transport.clone(),
        local_port,
        registrar_host,
        registrar_port,
    )
    .map_err(|e| e.to_string())?;
    transport.update_local_ip().map_err(|e| e.to_string())?;
    let local_ip = transport.get_local_ip_address();

    let aor_domain = registrar_uri.host.clone();
    let entity_uri = format!("sip:{}@{}", config.username, aor_domain);
    let request_uri = entity_uri.clone();
    let pidf = build_pidf(&entity_uri, state);

    let call_id = generate_call_id();
    let from_tag = generate_tag();
    let branch = format!("z9hG4bK{}", generate_tag());

    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        crate::core::config::TransportType::Tcp => "TCP",
        crate::core::config::TransportType::Tls => "TLS",
        crate::core::config::TransportType::Wss => "WSS",
    };

    let mut req = SipMessage::new_request("PUBLISH", &request_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, local_port, branch
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header("From", &format!("<{}>;tag={}", entity_uri, from_tag));
    req.add_header("To", &format!("<{}>", entity_uri));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", "1 PUBLISH");
    req.add_header("Event", "presence");
    req.add_header("Expires", &expires.to_string());
    req.add_header("Content-Type", "application/pidf+xml");
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    if let Some(etag) = sip_if_match {
        req.add_header("SIP-If-Match", etag);
    }
    req.body = Some(pidf);

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&req_bytes).map_err(|e| e.to_string())?;

    let response_bytes = transport
        .receive(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let resp = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    let code = resp.status_code.unwrap_or(0);

    if code == 401 || code == 407 {
        let auth_header_name = if code == 401 {
            "WWW-Authenticate"
        } else {
            "Proxy-Authenticate"
        };
        let challenge_str = resp
            .get_header(auth_header_name)
            .cloned()
            .ok_or("No auth challenge")?;
        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let auth_challenge =
            auth::parse_auth_challenge(&challenge_str, default_realm).map_err(|e| e.to_string())?;
        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let password = &config.password;
        let auth_value = auth::build_digest_authorization(
            "PUBLISH",
            &request_uri,
            username,
            password,
            &auth_challenge,
        );

        let branch2 = format!("z9hG4bK{}", generate_tag());
        let mut auth_req = SipMessage::new_request("PUBLISH", &request_uri);
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch={}",
                via_transport, local_ip, local_port, branch2
            ),
        );
        auth_req.add_header("Max-Forwards", "70");
        auth_req.add_header("From", &format!("<{}>;tag={}", entity_uri, from_tag));
        auth_req.add_header("To", &format!("<{}>", entity_uri));
        auth_req.add_header("Call-ID", &call_id);
        auth_req.add_header("CSeq", "2 PUBLISH");
        auth_req.add_header("Event", "presence");
        auth_req.add_header("Expires", &expires.to_string());
        auth_req.add_header("Content-Type", "application/pidf+xml");
        auth_req.add_header("User-Agent", &user_agent::get_effective_user_agent());
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        if let Some(etag) = sip_if_match {
            auth_req.add_header("SIP-If-Match", etag);
        }
        auth_req.body = req.body.clone();

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;

        let resp2_bytes = transport
            .receive(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let resp2 = SipMessage::from_bytes(&resp2_bytes).map_err(|e| e.to_string())?;
        let code2 = resp2.status_code.unwrap_or(0);
        if code2 < 200 || code2 >= 300 {
            return Err(format!(
                "PUBLISH auth failed: {} {}",
                code2,
                resp2.status_text.as_deref().unwrap_or("")
            ));
        }
        return Ok(resp2.get_header("SIP-ETag").cloned());
    }

    if code < 200 || code >= 300 {
        return Err(format!(
            "PUBLISH failed: {} {}",
            code,
            resp.status_text.as_deref().unwrap_or("")
        ));
    }

    Ok(resp.get_header("SIP-ETag").cloned())
}

/// Remove presence publication (Expires: 0).
pub fn unpublish_presence(registrar_id: &str, sip_if_match: &str) -> Result<(), String> {
    publish_presence(registrar_id, PresenceState::Closed, Some(sip_if_match), 0)?;
    Ok(())
}
