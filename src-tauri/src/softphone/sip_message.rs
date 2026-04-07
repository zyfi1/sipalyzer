//! SIP MESSAGE method support (RFC 3428) — page-mode instant messaging over SIP.
//!
//! Sends and receives text messages via the SIP MESSAGE method.
//! Inbound messages arrive on the inbound listener and are emitted as events.

use std::net::SocketAddr;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter;

use crate::core::database::Database;
use crate::core::user_agent;
use crate::sip::auth;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::Transport;
use crate::sip::uri::SipUri;

#[derive(Debug, Clone, Serialize)]
pub struct SipInstantMessage {
    pub from: String,
    pub to: String,
    pub body: String,
    pub content_type: String,
    pub timestamp: String,
    pub direction: String,
}

/// Send a SIP MESSAGE to a target URI.
pub fn send_message(
    registrar_id: &str,
    target: &str,
    body: &str,
    content_type: Option<&str>,
) -> Result<(), String> {
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
    let ct = content_type.unwrap_or("text/plain");

    // Build target URI: if it doesn't contain @, append domain
    let request_uri = if target.contains('@') {
        if target.starts_with("sip:") {
            target.to_string()
        } else {
            format!("sip:{}", target)
        }
    } else {
        format!("sip:{}@{}", target, aor_domain)
    };

    let call_id = generate_call_id();
    let from_tag = generate_tag();
    let branch = format!("z9hG4bK{}", generate_tag());

    let via_transport = match config.transport {
        crate::core::config::TransportType::Udp => "UDP",
        crate::core::config::TransportType::Tcp => "TCP",
        crate::core::config::TransportType::Tls => "TLS",
        crate::core::config::TransportType::Wss => "WSS",
    };

    let mut req = SipMessage::new_request("MESSAGE", &request_uri);
    req.add_header(
        "Via",
        &format!(
            "SIP/2.0/{} {}:{};rport;branch={}",
            via_transport, local_ip, local_port, branch
        ),
    );
    req.add_header("Max-Forwards", "70");
    req.add_header(
        "From",
        &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag),
    );
    req.add_header("To", &format!("<{}>", request_uri));
    req.add_header("Call-ID", &call_id);
    req.add_header("CSeq", "1 MESSAGE");
    req.add_header("Content-Type", ct);
    req.add_header("User-Agent", &user_agent::get_effective_user_agent());
    req.body = Some(body.to_string());

    let req_bytes = req.to_bytes().map_err(|e| e.to_string())?;
    transport.send(&req_bytes).map_err(|e| e.to_string())?;
    super::sip_log::log_bytes(&call_id, "send", &req_bytes);

    // Read response
    let response_bytes = transport
        .receive(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let resp = SipMessage::from_bytes(&response_bytes).map_err(|e| e.to_string())?;
    let code = resp.status_code.unwrap_or(0);

    // Handle 401/407 auth challenge
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
            "MESSAGE",
            &request_uri,
            username,
            password,
            &auth_challenge,
        );

        let branch2 = format!("z9hG4bK{}", generate_tag());
        let mut auth_req = SipMessage::new_request("MESSAGE", &request_uri);
        auth_req.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch={}",
                via_transport, local_ip, local_port, branch2
            ),
        );
        auth_req.add_header("Max-Forwards", "70");
        auth_req.add_header(
            "From",
            &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag),
        );
        auth_req.add_header("To", &format!("<{}>", request_uri));
        auth_req.add_header("Call-ID", &call_id);
        auth_req.add_header("CSeq", "2 MESSAGE");
        auth_req.add_header("Content-Type", ct);
        auth_req.add_header("User-Agent", &user_agent::get_effective_user_agent());
        if code == 401 {
            auth_req.add_header("Authorization", &auth_value);
        } else {
            auth_req.add_header("Proxy-Authorization", &auth_value);
        }
        auth_req.body = Some(body.to_string());

        let auth_bytes = auth_req.to_bytes().map_err(|e| e.to_string())?;
        transport.send(&auth_bytes).map_err(|e| e.to_string())?;
        super::sip_log::log_bytes(&call_id, "send", &auth_bytes);

        let resp2_bytes = transport
            .receive(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let resp2 = SipMessage::from_bytes(&resp2_bytes).map_err(|e| e.to_string())?;
        let code2 = resp2.status_code.unwrap_or(0);
        if code2 < 200 || code2 >= 300 {
            return Err(format!(
                "MESSAGE auth failed: {} {}",
                code2,
                resp2.status_text.as_deref().unwrap_or("")
            ));
        }
    } else if code < 200 || code >= 300 {
        return Err(format!(
            "MESSAGE failed: {} {}",
            code,
            resp.status_text.as_deref().unwrap_or("")
        ));
    }

    Ok(())
}

/// Handle an incoming SIP MESSAGE on the inbound listener.
/// Returns true if it was a MESSAGE (handled), false otherwise.
pub fn handle_incoming_message(
    msg: &SipMessage,
    socket: &std::net::UdpSocket,
    peer: SocketAddr,
    app_handle: &tauri::AppHandle,
) -> bool {
    if !msg.method.eq_ignore_ascii_case("MESSAGE") {
        return false;
    }

    // Send 200 OK
    let mut ok = SipMessage::new_response(200, "OK");
    if let Some(v) = msg.get_header("Via") {
        ok.add_header("Via", v);
    }
    if let Some(v) = msg.get_header("From") {
        ok.add_header("From", v);
    }
    if let Some(v) = msg.get_header("To") {
        ok.add_header("To", v);
    }
    if let Some(v) = msg.get_header("Call-ID") {
        ok.add_header("Call-ID", v);
    }
    if let Some(v) = msg.get_header("CSeq") {
        ok.add_header("CSeq", v);
    }
    if let Ok(bytes) = ok.to_bytes() {
        let _ = socket.send_to(&bytes, peer);
    }

    let from = msg.get_header("From").cloned().unwrap_or_default();
    let to = msg.get_header("To").cloned().unwrap_or_default();
    let body = msg.body.as_deref().unwrap_or("").to_string();
    let content_type = msg
        .get_header("Content-Type")
        .cloned()
        .unwrap_or_else(|| "text/plain".to_string());
    let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let im = SipInstantMessage {
        from: from.clone(),
        to,
        body,
        content_type,
        timestamp: ts,
        direction: "recv".to_string(),
    };

    let payload = serde_json::json!({
        "from": im.from,
        "to": im.to,
        "body": im.body,
        "contentType": im.content_type,
        "timestamp": im.timestamp,
        "direction": im.direction,
    });
    let _ = app_handle.emit("softphone:sip_message_received", payload);
    tracing::info!("Received MESSAGE from {}: {}", im.from, im.body);

    true
}
