use crate::core::config::RegistrarConfig;
use crate::core::user_agent;
use crate::sip::auth;
use crate::sip::stack::{generate_call_id, generate_tag, SipMessage};
use crate::sip::transport::Transport;
use crate::sip::uri::SipUri;
use anyhow::{Context, Result};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct RegistrationResult {
    pub success: bool,
    pub status_code: u16,
    pub status_text: String,
    pub response_time_ms: u64,
    pub expires: Option<u32>,
    pub error: Option<String>,
    pub request_message: String,
    pub response_message: String,
}

pub struct RegistrationTester;

impl RegistrationTester {
    /// Test registration with default expires (3600)
    pub fn test_registration(config: &RegistrarConfig) -> Result<RegistrationResult> {
        Self::test_registration_with_expires(config, 3600)
    }

    /// Test registration with custom expires value
    pub fn test_registration_with_expires(
        config: &RegistrarConfig,
        expires: u32,
    ) -> Result<RegistrationResult> {
        let transport_str = format!("{:?}", config.transport);
        let _reg_span = tracing::info_span!("sip.registration",
            domain = %config.domain,
            transport = %transport_str,
            timeout = config.timeout_seconds,
        )
        .entered();

        let start_time = Instant::now();

        // Determine local port
        let local_port = config.local_port.unwrap_or(5060);

        // Parse the domain as a SIP URI to extract host/port
        // The domain field can be:
        // - A SIP URI (sip:host, sip:host:port, sip:user@host:port)
        // - Just a hostname (example.com)
        // - An IP address (192.168.1.1)
        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;

        // Use port from URI if present, otherwise use remote_port from config
        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();

        // Create transport using the resolved host and port
        let mut transport = {
            let _dns_span = tracing::info_span!("sip.dns_resolve").entered();
            Transport::new(
                config.transport.clone(),
                local_port,
                registrar_host,
                registrar_port,
            )?
        };

        // Update local IP from actual connection if not already detected
        transport.update_local_ip()?;

        // Get the actual local IP address from the transport
        let local_ip = transport.get_local_ip_address();

        // Generate SIP identifiers
        let call_id = generate_call_id();
        let from_tag = generate_tag();
        let _to_tag = generate_tag();
        let branch = format!("z9hG4bK{}", generate_tag());

        // Build RFC-compliant REGISTER request URI
        // For REGISTER, the Request-URI should be the registrar's address
        // Format: sip:registrar-host or sip:registrar-host:port
        let request_uri = if registrar_port == 5060 {
            format!("sip:{}", registrar_host)
        } else {
            format!("sip:{}:{}", registrar_host, registrar_port)
        };

        let mut request = SipMessage::new_request("REGISTER", &request_uri);

        // Determine transport protocol for Via header
        let via_transport = match config.transport {
            crate::core::config::TransportType::Udp => "UDP",
            crate::core::config::TransportType::Tcp => "TCP",
            crate::core::config::TransportType::Tls => "TLS",
            crate::core::config::TransportType::Wss => "WSS",
        };

        // Use register_interval_seconds from config if available, otherwise use provided expires
        // EXCEPT: If expires is 0 (unregister), always use 0 regardless of config
        let expires_value = if expires == 0 {
            0 // Force 0 for unregistration
        } else {
            config
                .register_interval_seconds
                .map(|s| s as u32)
                .unwrap_or(expires)
        };

        // Build RFC-compliant headers
        // Via header: SIP/2.0/TRANSPORT host:port;rport;branch=branch-value
        // Use listening_port if set (user-specified reachable port, e.g. port-forwarded),
        // otherwise use local_port. Include rport (RFC 3581) for NAT traversal so
        // the server reports back the actual observed source port.
        let via_port = config.listening_port.unwrap_or(local_port);
        request.add_header(
            "Via",
            &format!(
                "SIP/2.0/{} {}:{};rport;branch={}",
                via_transport, local_ip, via_port, branch
            ),
        );
        request.add_header("Max-Forwards", "70");

        // To header: sip:user@domain (the AOR - Address of Record)
        // The AOR domain is typically the domain from the config, not the registrar host
        // The registrar host is where we send the REGISTER, the AOR domain is the user's domain
        // Parse config.domain to extract the domain part if it's a SIP URI
        let aor_uri = SipUri::parse(&config.domain).context("Failed to parse AOR domain")?;
        let aor_domain = aor_uri.host.clone();

        request.add_header("To", &format!("<sip:{}@{}>", config.username, aor_domain));

        // From header: same as To but with tag
        request.add_header(
            "From",
            &format!("<sip:{}@{}>;tag={}", config.username, aor_domain, from_tag),
        );
        request.add_header("Call-ID", &call_id);
        request.add_header("CSeq", "1 REGISTER");

        // Contact header: sip:user@contact-address:port (use listening_port for inbound calls if set)
        let contact_port = config.listening_port.unwrap_or(local_port);
        let contact_header = if expires_value == 0 {
            format!(
                "<sip:{}@{}:{}>;expires=0",
                config.username, local_ip, contact_port
            )
        } else {
            format!("<sip:{}@{}:{}>", config.username, local_ip, contact_port)
        };
        request.add_header("Contact", &contact_header);
        request.add_header("Expires", &expires_value.to_string());
        request.add_header("User-Agent", &user_agent::get_effective_user_agent());

        // Add custom headers
        for header in &config.custom_headers {
            request.add_header(&header.name, &header.value);
        }

        let request_bytes = request.to_bytes()?;
        let request_text = String::from_utf8_lossy(&request_bytes);

        // Send request
        {
            let _send_span = tracing::info_span!("sip.register_send").entered();
            transport
                .send(&request_bytes)
                .context("Failed to send REGISTER request")?;
        }

        // Receive response
        let timeout = Duration::from_secs(config.timeout_seconds);
        let response_bytes = transport
            .receive(timeout)
            .context("Failed to receive REGISTER response")?;

        let (response, status_code, status_text) = {
            let _parse_span = tracing::info_span!("sip.response_parse").entered();
            let resp = SipMessage::from_bytes(&response_bytes)
                .context("Failed to parse REGISTER response")?;
            let code = resp.status_code.unwrap_or(0);
            let text = resp.status_text.clone().unwrap_or_default();
            (resp, code, text)
        };

        let response_text = String::from_utf8_lossy(&response_bytes);
        let response_time = start_time.elapsed().as_millis() as u64;

        // Handle 401/407 challenge
        if status_code == 401 || status_code == 407 {
            return Self::handle_auth_challenge(
                &transport, &request, &response, config, &call_id, &from_tag, timeout,
            );
        }

        let expires = response
            .get_header("Expires")
            .and_then(|v| v.parse::<u32>().ok());

        let error_message = if status_code >= 400 {
            Some(format!(
                "Registration failed: {} {}",
                status_code,
                status_text.clone()
            ))
        } else {
            None
        };

        Ok(RegistrationResult {
            success: status_code >= 200 && status_code < 300,
            status_code,
            status_text,
            response_time_ms: response_time,
            expires,
            error: error_message,
            request_message: request_text.to_string(),
            response_message: response_text.to_string(),
        })
    }

    fn handle_auth_challenge(
        transport: &Transport,
        original_request: &SipMessage,
        challenge: &SipMessage,
        config: &RegistrarConfig,
        _call_id: &str,
        _from_tag: &str,
        timeout: Duration,
    ) -> Result<RegistrationResult> {
        let _auth_span = tracing::info_span!("sip.auth_challenge").entered();

        // Extract authentication challenge
        let auth_header = if challenge.status_code == Some(401) {
            challenge.get_header("WWW-Authenticate")
        } else {
            challenge.get_header("Proxy-Authenticate")
        };

        let auth_header = auth_header.context("Missing authentication challenge header")?;

        let default_realm = config.realm.as_deref().unwrap_or(&config.domain);
        let auth_challenge = auth::parse_auth_challenge(auth_header, default_realm)
            .map_err(|e| anyhow::anyhow!(e))?;

        let username = config.auth_username.as_ref().unwrap_or(&config.username);
        let password = &config.password;
        // For digest authentication, the URI in ha2 should match the Request-URI
        let registrar_uri = SipUri::parse(&config.domain)
            .context("Failed to parse registrar domain for authentication")?;
        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();
        let request_uri = if registrar_port == 5060 {
            format!("sip:{}", registrar_host)
        } else {
            format!("sip:{}:{}", registrar_host, registrar_port)
        };

        // Build authenticated request with same Request-URI
        let mut auth_request = SipMessage::new_request("REGISTER", &request_uri);

        // Get CSeq from original request
        let cseq = original_request
            .get_header("CSeq")
            .and_then(|v| v.split_whitespace().next())
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(1);

        // Copy headers from original request (except CSeq which we'll update)
        for (name, value) in &original_request.headers {
            if name.to_lowercase() != "cseq" {
                auth_request.add_header(name, value);
            }
        }

        // Update CSeq
        auth_request.add_header("CSeq", &format!("{} REGISTER", cseq + 1));

        // Use the same request URI in the Authorization header
        let auth_value = auth::build_digest_authorization(
            "REGISTER",
            &request_uri,
            username,
            password,
            &auth_challenge,
        );

        if challenge.status_code == Some(401) {
            auth_request.add_header("Authorization", &auth_value);
        } else {
            auth_request.add_header("Proxy-Authorization", &auth_value);
        }

        let request_bytes = auth_request.to_bytes()?;
        let request_text = String::from_utf8_lossy(&request_bytes);

        let (response, response_text) = {
            let _auth_reg_span = tracing::info_span!("sip.authenticated_register").entered();

            // Send authenticated request
            transport
                .send(&request_bytes)
                .context("Failed to send authenticated REGISTER request")?;

            // Receive final response
            let response_bytes = transport
                .receive(timeout)
                .context("Failed to receive authenticated REGISTER response")?;

            let resp = SipMessage::from_bytes(&response_bytes)
                .context("Failed to parse authenticated REGISTER response")?;

            let resp_text = String::from_utf8_lossy(&response_bytes).to_string();
            (resp, resp_text)
        };
        let status_code = response.status_code.unwrap_or(0);
        let status_text = response.status_text.clone().unwrap_or_default();

        let expires = response
            .get_header("Expires")
            .and_then(|v| v.parse::<u32>().ok());

        let error_message = if status_code >= 400 {
            Some(format!(
                "Registration failed: {} {}",
                status_code,
                status_text.clone()
            ))
        } else {
            None
        };

        Ok(RegistrationResult {
            success: status_code >= 200 && status_code < 300,
            status_code,
            status_text,
            response_time_ms: 0, // Will be calculated by caller
            expires,
            error: error_message,
            request_message: request_text.to_string(),
            response_message: response_text.to_string(),
        })
    }
}
