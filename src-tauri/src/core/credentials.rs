use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chacha20poly1305::{
    Key, KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use getrandom::fill as fill_random;

use super::database::Database;

pub struct CredentialStore;

const CREDENTIAL_PREFIX: &str = "enc:v1:";
const AAD_CONTEXT: &[u8] = b"sipalyzer-credential-store-v1";

impl CredentialStore {
    fn derive_key() -> Result<[u8; 32]> {
        Database::derive_install_subkey(Database::credential_key_context())
    }

    fn encrypt_with_key(password: &str, key: &[u8; 32]) -> Result<String> {
        let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
        let mut nonce = [0u8; 24];
        fill_random(&mut nonce).context("Failed to generate credential nonce")?;
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: password.as_bytes(),
                    aad: AAD_CONTEXT,
                },
            )
            .map_err(|_| anyhow!("Failed to encrypt credential"))?;

        let mut payload = Vec::with_capacity(24 + ciphertext.len());
        payload.extend_from_slice(&nonce);
        payload.extend_from_slice(&ciphertext);
        Ok(format!("{CREDENTIAL_PREFIX}{}", B64.encode(payload)))
    }

    fn decrypt_with_key(encrypted: &str, key: &[u8; 32]) -> Result<String> {
        if !encrypted.starts_with(CREDENTIAL_PREFIX) {
            return Ok(encrypted.to_string());
        }

        let encoded = &encrypted[CREDENTIAL_PREFIX.len()..];
        let payload = B64.decode(encoded).context("Credential payload is invalid base64")?;
        if payload.len() < 25 {
            bail!("Credential payload is truncated");
        }

        let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
        let (nonce, ciphertext) = payload.split_at(24);
        let plaintext = cipher
            .decrypt(
                XNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: AAD_CONTEXT,
                },
            )
            .map_err(|_| anyhow!("Failed to decrypt credential"))?;

        String::from_utf8(plaintext).context("Credential plaintext is not valid UTF-8")
    }

    /// Encrypt a password at rest with authenticated encryption.
    pub fn encrypt_password(password: &str) -> Result<String> {
        let key = Self::derive_key()?;
        Self::encrypt_with_key(password, &key)
    }

    /// Decrypt a password. Legacy plaintext values are returned as-is.
    pub fn decrypt_password(encrypted: &str) -> Result<String> {
        let key = Self::derive_key()?;
        Self::decrypt_with_key(encrypted, &key)
    }
}

#[cfg(test)]
mod tests {
    use super::CredentialStore;

    #[test]
    fn decrypts_legacy_plaintext_credentials() {
        let key = [7u8; 32];
        let output = CredentialStore::decrypt_with_key("legacy-secret", &key).expect("decrypt");
        assert_eq!(output, "legacy-secret");
    }

    #[test]
    fn encrypt_decrypt_round_trip_v1_payload() {
        let key = [9u8; 32];
        let encrypted = CredentialStore::encrypt_with_key("s3cr3t!", &key).expect("encrypt");
        assert!(encrypted.starts_with("enc:v1:"));
        let decrypted = CredentialStore::decrypt_with_key(&encrypted, &key).expect("decrypt");
        assert_eq!(decrypted, "s3cr3t!");
    }

    #[test]
    fn encrypted_payload_detects_tampering() {
        let key = [11u8; 32];
        let encrypted = CredentialStore::encrypt_with_key("safe", &key).expect("encrypt");
        let mut tampered = encrypted.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).expect("utf8");
        assert!(CredentialStore::decrypt_with_key(&tampered, &key).is_err());
    }
}
