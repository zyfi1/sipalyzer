//! RFC 2617 HTTP Digest authentication for SIP (RFC 3261 §22).
//! - HA1 = MD5(username:realm:password); HA2 = MD5(method:uri) where uri is Request-URI.
//! - If qop=auth: response = MD5(HA1:nonce:nc:cnonce:qop:HA2); nc and cnonce in Authorization.

#![allow(dead_code)]

use crate::sip::stack::generate_tag;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AuthChallenge {
    pub realm: String,
    pub nonce: String,
    pub qop: Option<String>,
}

/// Extract a quoted parameter from Authorization/WWW-Authenticate (e.g. realm="x").
pub fn extract_auth_param(header: &str, param: &str) -> Option<String> {
    let search = format!("{}=\"", param);
    if let Some(start) = header.find(&search) {
        let start = start + search.len();
        if let Some(end) = header[start..].find('"') {
            return Some(header[start..start + end].to_string());
        }
    }
    None
}

#[allow(dead_code)]
fn parse_qop(header: &str) -> Option<String> {
    let qop = extract_auth_param(header, "qop")?;
    let normalized = qop
        .split(',')
        .map(|v| v.trim().trim_matches('"').to_string())
        .collect::<Vec<_>>();
    if normalized.iter().any(|v| v.eq_ignore_ascii_case("auth")) {
        Some("auth".to_string())
    } else {
        normalized.first().cloned().filter(|v| !v.is_empty())
    }
}

#[allow(dead_code)]
pub fn parse_auth_challenge(header: &str, default_realm: &str) -> Result<AuthChallenge, String> {
    let realm = extract_auth_param(header, "realm").unwrap_or_else(|| default_realm.to_string());
    let nonce = extract_auth_param(header, "nonce")
        .ok_or_else(|| "Missing nonce in auth challenge".to_string())?;
    let qop = parse_qop(header);
    Ok(AuthChallenge { realm, nonce, qop })
}

#[allow(dead_code)]
pub fn build_digest_authorization(
    method: &str,
    uri: &str,
    username: &str,
    password: &str,
    challenge: &AuthChallenge,
) -> String {
    let _span = tracing::info_span!("sip.digest_compute",
        realm = %challenge.realm,
        algorithm = "MD5",
    )
    .entered();

    let ha1 = format!("{}:{}:{}", username, challenge.realm, password);
    let ha1_md5 = format!("{:x}", md5::compute(ha1.as_bytes()));

    let ha2 = format!("{}:{}", method, uri);
    let ha2_md5 = format!("{:x}", md5::compute(ha2.as_bytes()));

    if let Some(qop) = &challenge.qop {
        let nc = "00000001";
        let cnonce = generate_tag();
        let response = format!(
            "{}:{}:{}:{}:{}:{}",
            ha1_md5, challenge.nonce, nc, cnonce, qop, ha2_md5
        );
        let response_md5 = format!("{:x}", md5::compute(response.as_bytes()));
        // RFC 2617: uri is Request-URI; qop value (e.g. auth) matches challenge
        format!(
            r#"Digest username="{}", realm="{}", nonce="{}", uri="{}", response="{}", qop={}, nc={}, cnonce="{}""#,
            username, challenge.realm, challenge.nonce, uri, response_md5, qop, nc, cnonce
        )
    } else {
        let response = format!("{}:{}:{}", ha1_md5, challenge.nonce, ha2_md5);
        let response_md5 = format!("{:x}", md5::compute(response.as_bytes()));
        format!(
            r#"Digest username="{}", realm="{}", nonce="{}", uri="{}", response="{}""#,
            username, challenge.realm, challenge.nonce, uri, response_md5
        )
    }
}

/// Server-side: compute expected digest response for verification.
/// password is the stored secret (plain password or HA1 depending on store).
/// Returns the expected response hex string.
pub fn compute_expected_digest_response(
    method: &str,
    uri: &str,
    username: &str,
    password: &str,
    realm: &str,
    nonce: &str,
    qop: Option<&str>,
    nc: &str,
    cnonce: &str,
) -> String {
    let ha1 = format!("{}:{}:{}", username, realm, password);
    let ha1_md5 = format!("{:x}", md5::compute(ha1.as_bytes()));
    let ha2 = format!("{}:{}", method, uri);
    let ha2_md5 = format!("{:x}", md5::compute(ha2.as_bytes()));
    if let Some(q) = qop {
        let response = format!("{}:{}:{}:{}:{}:{}", ha1_md5, nonce, nc, cnonce, q, ha2_md5);
        format!("{:x}", md5::compute(response.as_bytes()))
    } else {
        let response = format!("{}:{}:{}", ha1_md5, nonce, ha2_md5);
        format!("{:x}", md5::compute(response.as_bytes()))
    }
}
