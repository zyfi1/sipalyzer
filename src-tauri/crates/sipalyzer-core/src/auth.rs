//! Authentication types and helpers for the agent <-> controller handshake.
//!
//! The auth flow is:
//! 1. Agent connects via WebSocket.
//! 2. Controller sends `AuthChallenge` with a random nonce.
//! 3. Agent computes HMAC-SHA256(nonce, pre_shared_token) and replies with `AuthResponse`.
//! 4. Controller verifies the HMAC. If valid, agent is authenticated.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Sent by the controller to challenge the connecting agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthChallenge {
    /// Random hex-encoded nonce (32 bytes).
    pub nonce: String,
    /// Protocol version for forward compatibility.
    pub protocol_version: u32,
}

/// Sent by the agent in response to the challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    /// The agent's unique ID (from its config).
    pub agent_id: String,
    /// HMAC-SHA256(nonce, token) as hex string.
    pub hmac: String,
    /// Protocol version the agent supports.
    pub protocol_version: u32,
    /// Agent profile: "standard" or "full".
    #[serde(default)]
    pub profile: String,
    /// List of tool capabilities this agent supports.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// Current protocol version.
pub const PROTOCOL_VERSION: u32 = 1;

/// Compute the HMAC-SHA256 of a nonce using the pre-shared token.
pub fn compute_hmac(nonce: &str, token: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC can take key of any size");
    mac.update(nonce.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

/// Verify an HMAC response against the expected nonce and token.
pub fn verify_hmac(nonce: &str, token: &str, provided_hmac: &str) -> bool {
    let expected = compute_hmac(nonce, token);
    // Constant-time comparison to prevent timing attacks
    constant_time_eq(expected.as_bytes(), provided_hmac.as_bytes())
}

/// Constant-time byte comparison.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Generate a random hex nonce (32 bytes = 64 hex chars).
pub fn generate_nonce() -> String {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    // Mix timestamp + random UUID for entropy
    hasher.update(uuid::Uuid::new_v4().as_bytes());
    hasher.update(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_le_bytes(),
    );
    hex::encode(hasher.finalize())
}

/// Generate a random pre-shared token (32 bytes hex-encoded).
pub fn generate_token() -> String {
    // Use two UUIDs for 32 bytes of randomness
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(a.as_bytes());
    bytes.extend_from_slice(b.as_bytes());
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_roundtrip() {
        let nonce = generate_nonce();
        let token = generate_token();
        let hmac = compute_hmac(&nonce, &token);
        assert!(verify_hmac(&nonce, &token, &hmac));
    }

    #[test]
    fn test_hmac_wrong_token() {
        let nonce = generate_nonce();
        let token = generate_token();
        let hmac = compute_hmac(&nonce, &token);
        assert!(!verify_hmac(&nonce, "wrong_token", &hmac));
    }
}
