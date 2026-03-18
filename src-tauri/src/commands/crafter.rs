//! Request Crafter commands — send SIP and HTTP requests from the frontend.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

use crate::core::config::TransportType;
use crate::core::user_agent;
use crate::sip::auth::{parse_auth_challenge, build_digest_authorization};
use crate::sip::stack::{SipMessage, generate_call_id, generate_tag};
use crate::sip::transport::{Transport, find_available_port};
use crate::sip::uri::SipUri;

// ── SIP Crafter ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct CrafterSipAuth {
    pub username: Option<String>,
    pub password: Option<String>,
    pub realm: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CrafterSendSipInput {
    pub method: String,
    pub uri: String,
    pub headers: Vec<KeyValue>,
    pub body: Option<String>,
    pub transport: String, // "UDP" | "TCP" | "TLS"
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub auth: Option<CrafterSipAuth>,
    pub timeout_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SipResponseHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SipResponsePart {
    pub raw: String,
    pub status_code: Option<u16>,
    pub status_text: Option<String>,
    pub headers: Vec<SipResponseHeader>,
    pub body: Option<String>,
    pub timestamp: i64,
    pub round_trip_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CrafterSipResponse {
    pub responses: Vec<SipResponsePart>,
    pub error: Option<String>,
}

fn parse_sip_response(raw: &[u8]) -> Result<SipResponsePart> {
    let msg = SipMessage::from_bytes(raw)?;
    let raw_str = String::from_utf8_lossy(raw).to_string();

    let mut headers_vec = Vec::new();
    for (k, v) in &msg.headers {
        headers_vec.push(SipResponseHeader { key: k.clone(), value: v.clone() });
    }

    Ok(SipResponsePart {
        raw: raw_str,
        status_code: msg.status_code,
        status_text: msg.status_text,
        headers: headers_vec,
        body: msg.body,
        timestamp: chrono::Utc::now().timestamp_millis(),
        round_trip_ms: None,
    })
}

fn transport_from_str(s: &str) -> TransportType {
    match s.to_uppercase().as_str() {
        "TCP" => TransportType::Tcp,
        "TLS" => TransportType::Tls,
        "WSS" => TransportType::Wss,
        _ => TransportType::Udp,
    }
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn crafter_send_sip(input: CrafterSendSipInput) -> Result<CrafterSipResponse, String> {
    crafter_send_sip_impl(input).map_err(|e| e.to_string())
}

fn crafter_send_sip_impl(input: CrafterSendSipInput) -> Result<CrafterSipResponse> {
    let timeout = Duration::from_secs(input.timeout_sec);
    let transport_type = transport_from_str(&input.transport);
    let proto = match transport_type {
        TransportType::Udp => "UDP",
        TransportType::Tcp => "TCP",
        TransportType::Tls => "TLS",
        TransportType::Wss => "WSS",
    };

    // Parse URI for target host/port
    let uri_parsed = SipUri::parse(&input.uri)
        .context("Invalid SIP URI")?;
    let target_host = input.target_host
        .unwrap_or_else(|| uri_parsed.host.clone());
    let target_port = input.target_port
        .or(uri_parsed.port)
        .unwrap_or(if uri_parsed.scheme == "sips" { 5061 } else { 5060 });

    // Bind to ephemeral port
    let local_port = find_available_port(5062)
        .context("No available local port")?;

    let transport = Transport::new(
        transport_type,
        local_port,
        &target_host,
        target_port,
    )?;

    let mut msg = SipMessage::new_request(&input.method, &input.uri);

    // Build headers from input
    for kv in &input.headers {
        msg.add_header(&kv.key, &kv.value);
    }

    // Ensure required headers exist (use defaults if missing)
    if msg.get_header("Via").is_none() {
        let local_ip = transport.get_local_ip_address();
        let branch = format!("z9hG4bK{}", &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]);
        msg.add_header("Via", &format!("SIP/2.0/{} {}:{};branch={}", proto, local_ip, local_port, branch));
    }
    if msg.get_header("From").is_none() {
        let tag = generate_tag();
        msg.add_header("From", &format!("<sip:sipalyzer@{}>;tag={}", transport.get_local_ip_address(), tag));
    }
    if msg.get_header("To").is_none() {
        msg.add_header("To", &format!("<{}>", input.uri));
    }
    if msg.get_header("Call-ID").is_none() {
        msg.add_header("Call-ID", &generate_call_id());
    }
    if msg.get_header("CSeq").is_none() {
        msg.add_header("CSeq", &format!("1 {}", input.method));
    }
    if msg.get_header("Max-Forwards").is_none() {
        msg.add_header("Max-Forwards", "70");
    }
    if msg.get_header("Contact").is_none() {
        let local_ip = transport.get_local_ip_address();
        msg.add_header("Contact", &format!("<sip:sipalyzer@{}:{}>", local_ip, local_port));
    }
    if msg.get_header("User-Agent").is_none() {
        let effective_user_agent = user_agent::get_effective_user_agent();
        msg.add_header("User-Agent", &effective_user_agent);
    }

    if let Some(ref body) = input.body {
        if !body.is_empty() {
            msg.body = Some(body.clone());
            if msg.get_header("Content-Type").is_none() {
                msg.add_header("Content-Type", "application/sdp");
            }
        }
    }

    let bytes = msg.to_bytes()?;
    let sent_at = Instant::now();
    transport.send(&bytes)?;

    let mut responses = Vec::new();
    let mut auth_challenge: Option<(String, String)> = None; // (WWW-Authenticate or Proxy-Authenticate value, header name)

    loop {
        match transport.receive(timeout) {
            Ok(data) => {
                let elapsed_ms = sent_at.elapsed().as_millis() as u64;
                let mut part = parse_sip_response(&data)?;
                part.round_trip_ms = Some(elapsed_ms);

                // Check for 401/407 to potentially retry with auth
                if part.status_code == Some(401) {
                    if let Some(h) = part.headers.iter().find(|h| h.key.eq_ignore_ascii_case("WWW-Authenticate")) {
                        auth_challenge = Some((h.value.clone(), "Authorization".to_string()));
                    }
                } else if part.status_code == Some(407) {
                    if let Some(h) = part.headers.iter().find(|h| h.key.eq_ignore_ascii_case("Proxy-Authenticate")) {
                        auth_challenge = Some((h.value.clone(), "Proxy-Authorization".to_string()));
                    }
                }

                let is_final = part.status_code.map(|c| c >= 200).unwrap_or(false);
                responses.push(part);

                // Stop on final response (2xx for most methods, 1xx are provisional)
                if is_final {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    // If we got 401/407 and have auth credentials, retry with digest
    if let Some((challenge_value, auth_header_name)) = auth_challenge {
        if let Some(ref auth) = input.auth {
            if let (Some(ref user), Some(ref pass)) = (auth.username.as_ref(), auth.password.as_ref()) {
                let realm = auth.realm.as_deref().unwrap_or("");
                let challenge = parse_auth_challenge(&challenge_value, realm)
                    .map_err(|e| anyhow::anyhow!("{}", e))?;

                let auth_value = build_digest_authorization(
                    &input.method,
                    &input.uri,
                    user,
                    pass,
                    &challenge,
                );

                let mut retry_msg = SipMessage::new_request(&input.method, &input.uri);
                for kv in &input.headers {
                    retry_msg.add_header(&kv.key, &kv.value);
                }
                // Copy same Via, From, To, Call-ID; increment CSeq
                if let Some(v) = msg.get_header("Via") {
                    retry_msg.add_header("Via", v);
                }
                if let Some(v) = msg.get_header("From") {
                    retry_msg.add_header("From", v);
                }
                if let Some(v) = msg.get_header("To") {
                    retry_msg.add_header("To", v);
                }
                if let Some(v) = msg.get_header("Call-ID") {
                    retry_msg.add_header("Call-ID", v);
                }
                let cseq = msg.get_header("CSeq")
                    .map(|s| {
                        let parts: Vec<&str> = s.splitn(2, ' ').collect();
                        if parts.len() >= 2 {
                            if let Ok(n) = parts[0].parse::<u32>() {
                                return format!("{} {}", n + 1, input.method);
                            }
                        }
                        format!("2 {}", input.method)
                    })
                    .unwrap_or_else(|| format!("2 {}", input.method));
                retry_msg.add_header("CSeq", &cseq);
                if let Some(v) = msg.get_header("Max-Forwards") {
                    retry_msg.add_header("Max-Forwards", v);
                }
                if let Some(v) = msg.get_header("Contact") {
                    retry_msg.add_header("Contact", v);
                }
                if let Some(v) = msg.get_header("User-Agent") {
                    retry_msg.add_header("User-Agent", v);
                }

                retry_msg.add_header(&auth_header_name, &auth_value);
                if let Some(ref body) = input.body {
                    if !body.is_empty() {
                        retry_msg.body = Some(body.clone());
                        retry_msg.add_header("Content-Type", "application/sdp");
                    }
                }

                let retry_bytes = retry_msg.to_bytes()?;
                let retry_sent = Instant::now();
                transport.send(&retry_bytes)?;

                loop {
                    match transport.receive(timeout) {
                        Ok(data) => {
                            let elapsed_ms = retry_sent.elapsed().as_millis() as u64;
                            let mut part = parse_sip_response(&data)?;
                            part.round_trip_ms = Some(elapsed_ms);
                            let is_final = part.status_code.map(|c| c >= 200).unwrap_or(false);
                            responses.push(part);
                            if is_final {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    }

    Ok(CrafterSipResponse {
        responses,
        error: None,
    })
}

// ── HTTP Crafter ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct CrafterHttpAuth {
    pub r#type: String, // "none" | "basic" | "bearer" | "custom"
    pub username: Option<String>,
    pub password: Option<String>,
    pub bearer_token: Option<String>,
    pub custom_header: Option<String>,
    pub custom_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CrafterSendHttpInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub body: Option<String>,
    pub auth: Option<CrafterHttpAuth>,
    pub follow_redirects: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CrafterHttpResponse {
    pub status_code: u16,
    pub status_text: String,
    pub headers: Vec<SipResponseHeader>,
    pub body: String,
    pub timing_ms: u64,
    pub size_bytes: usize,
    pub redirects: Option<Vec<String>>,
    pub error: Option<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn crafter_send_http(input: CrafterSendHttpInput) -> Result<CrafterHttpResponse, String> {
    crafter_send_http_impl(input).map_err(|e| e.to_string())
}

fn crafter_send_http_impl(input: CrafterSendHttpInput) -> Result<CrafterHttpResponse> {
    use reqwest::blocking::Client;
    use reqwest::Method;

    let redirect_policy = if input.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };

    let client = Client::builder()
        .redirect(redirect_policy)
        .timeout(Duration::from_millis(if input.timeout_ms > 0 { input.timeout_ms } else { 30000 }))
        .build()
        .context("Failed to create HTTP client")?;

    let method = Method::from_bytes(input.method.as_bytes()).unwrap_or(Method::GET);
    let url: reqwest::Url = input.url.parse().context("Invalid URL")?;

    let mut req = client.request(method.clone(), url.clone());

    for kv in &input.headers {
        req = req.header(kv.key.as_str(), kv.value.as_str());
    }

    // Auth
    if let Some(ref auth) = input.auth {
        match auth.r#type.as_str() {
            "basic" => {
                if let (Some(u), Some(p)) = (&auth.username, &auth.password) {
                    let encoded = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        format!("{}:{}", u, p).as_bytes(),
                    );
                    req = req.header("Authorization", format!("Basic {}", encoded));
                }
            }
            "bearer" => {
                if let Some(token) = &auth.bearer_token {
                    req = req.header("Authorization", format!("Bearer {}", token));
                }
            }
            "custom" => {
                if let (Some(k), Some(v)) = (&auth.custom_header, &auth.custom_value) {
                    req = req.header(k.as_str(), v.as_str());
                }
            }
            _ => {}
        }
    }

    let body = input.body.unwrap_or_default();
    let start = Instant::now();

    let resp = if body.is_empty() {
        req.send()
    } else {
        req.body(body).send()
    }.context("HTTP request failed")?;

    let timing_ms = start.elapsed().as_millis() as u64;
    let status = resp.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

    let mut headers_vec = Vec::new();
    for (k, v) in resp.headers() {
        if let Ok(vs) = v.to_str() {
            headers_vec.push(SipResponseHeader { key: k.as_str().to_string(), value: vs.to_string() });
        }
    }

    let body_str = resp.text().unwrap_or_default();
    let size_bytes = body_str.len();

    let redirects: Option<Vec<String>> = None;

    Ok(CrafterHttpResponse {
        status_code,
        status_text,
        headers: headers_vec,
        body: body_str,
        timing_ms,
        size_bytes,
        redirects,
        error: None,
    })
}
