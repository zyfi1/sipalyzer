use anyhow::{Context, Result, anyhow, bail};
use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use rusqlite::params;
use sha2::{Sha256, Digest};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::database::Database;

pub struct AdminAuth;

const ADMIN_SESSION_TTL: Duration = Duration::from_secs(30 * 60);
static ADMIN_SESSION_EXPIRES_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

impl AdminAuth {
    fn session_expires_at() -> &'static Mutex<Option<Instant>> {
        ADMIN_SESSION_EXPIRES_AT.get_or_init(|| Mutex::new(None))
    }

    /// Start an authenticated admin session after successful verification.
    pub fn begin_authenticated_session() {
        if let Ok(mut guard) = Self::session_expires_at().lock() {
            *guard = Some(Instant::now() + ADMIN_SESSION_TTL);
        }
    }

    /// Clear any active admin session.
    pub fn clear_authenticated_session() {
        if let Ok(mut guard) = Self::session_expires_at().lock() {
            *guard = None;
        }
    }

    /// Returns true when a non-expired admin session is active.
    pub fn is_authenticated() -> bool {
        let Ok(mut guard) = Self::session_expires_at().lock() else {
            return false;
        };
        match *guard {
            Some(expires_at) if expires_at > Instant::now() => true,
            Some(_) => {
                *guard = None;
                false
            }
            None => false,
        }
    }

    /// Require a valid authenticated admin session.
    pub fn require_authenticated() -> Result<()> {
        if Self::is_authenticated() {
            return Ok(());
        }
        bail!("Admin authentication required")
    }

    /// Check whether an admin password has been set.
    pub fn has_password() -> Result<bool> {
        let conn = Database::get_connection()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM global_settings WHERE key = 'admin_password_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(count > 0)
    }

    /// Store a new admin password with Argon2id PHC format.
    pub fn set_password(password: &str) -> Result<()> {
        if password.is_empty() {
            bail!("Password cannot be empty");
        }
        let hash = Self::hash_password(password)?;
        let conn = Database::get_connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('admin_password_hash', ?1)",
            params![hash],
        )
        .context("Failed to store admin password")?;
        Ok(())
    }

    /// Verify a password against the stored hash. Returns true if correct.
    pub fn verify_password(password: &str) -> Result<bool> {
        let conn = Database::get_connection()?;
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM global_settings WHERE key = 'admin_password_hash'",
                [],
                |row| row.get(0),
            )
            .ok();

        match stored {
            Some(hash) => {
                let (valid, upgrade_hash) = Self::verify_against_stored_hash(password, &hash)?;
                if valid {
                    if let Some(new_hash) = upgrade_hash {
                        conn.execute(
                            "INSERT OR REPLACE INTO global_settings (key, value) VALUES ('admin_password_hash', ?1)",
                            params![new_hash],
                        )
                        .context("Failed to upgrade admin password hash")?;
                    }
                }
                Ok(valid)
            }
            None => Ok(false),
        }
    }

    fn hash_legacy_password(password: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"sipalyzer-admin-salt-v1");
        hasher.update(password.as_bytes());
        hex::encode(hasher.finalize())
    }

    fn hash_password(password: &str) -> Result<String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        argon2
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| anyhow!("Failed to hash admin password: {e}"))
    }

    fn verify_against_stored_hash(password: &str, stored_hash: &str) -> Result<(bool, Option<String>)> {
        if stored_hash.starts_with("$argon2") {
            let parsed = PasswordHash::new(stored_hash)
                .map_err(|e| anyhow!("Stored admin hash is invalid: {e}"))?;
            let ok = Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok();
            return Ok((ok, None));
        }

        let valid_legacy = Self::hash_legacy_password(password) == stored_hash;
        if !valid_legacy {
            return Ok((false, None));
        }

        let upgraded = Self::hash_password(password)?;
        Ok((true, Some(upgraded)))
    }
}

#[cfg(test)]
mod tests {
    use super::AdminAuth;

    #[test]
    fn legacy_hash_still_verifies_and_requests_upgrade() {
        let legacy = AdminAuth::hash_legacy_password("hunter2");
        let (ok, upgrade) = AdminAuth::verify_against_stored_hash("hunter2", &legacy).expect("verify");
        assert!(ok);
        assert!(upgrade.is_some());
        assert!(upgrade.expect("upgrade").starts_with("$argon2"));
    }

    #[test]
    fn argon2_hash_verifies_without_upgrade() {
        let hash = AdminAuth::hash_password("very-strong").expect("hash");
        let (ok, upgrade) = AdminAuth::verify_against_stored_hash("very-strong", &hash).expect("verify");
        assert!(ok);
        assert!(upgrade.is_none());
    }

    #[test]
    fn wrong_password_fails_for_legacy_and_argon2() {
        let legacy = AdminAuth::hash_legacy_password("correct");
        let (legacy_ok, legacy_upgrade) =
            AdminAuth::verify_against_stored_hash("wrong", &legacy).expect("legacy verify");
        assert!(!legacy_ok);
        assert!(legacy_upgrade.is_none());

        let argon = AdminAuth::hash_password("correct").expect("argon hash");
        let (argon_ok, argon_upgrade) =
            AdminAuth::verify_against_stored_hash("wrong", &argon).expect("argon verify");
        assert!(!argon_ok);
        assert!(argon_upgrade.is_none());
    }

    #[test]
    fn admin_session_can_be_created_and_cleared() {
        AdminAuth::clear_authenticated_session();
        assert!(!AdminAuth::is_authenticated());

        AdminAuth::begin_authenticated_session();
        assert!(AdminAuth::is_authenticated());

        AdminAuth::clear_authenticated_session();
        assert!(!AdminAuth::is_authenticated());
    }
}
