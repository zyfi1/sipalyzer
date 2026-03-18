//! Tauri commands for contact import functionality (LDAP)

use crate::contacts::{ldap, ImportedContact};
use serde::{Deserialize, Serialize};

/// LDAP configuration from frontend
#[derive(Debug, Serialize, Deserialize)]
pub struct LdapConfigInput {
    pub server_url: String,
    pub base_dn: String,
    pub bind_dn: Option<String>,
    pub bind_password: Option<String>,
    pub search_filter: Option<String>,
    pub use_tls: bool,
}

impl From<LdapConfigInput> for ldap::LdapConfig {
    fn from(input: LdapConfigInput) -> Self {
        ldap::LdapConfig {
            server_url: input.server_url,
            base_dn: input.base_dn,
            bind_dn: input.bind_dn,
            bind_password: input.bind_password,
            search_filter: input.search_filter,
            use_tls: input.use_tls,
        }
    }
}

/// Test LDAP connection
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn ldap_test_connection(config: LdapConfigInput) -> Result<String, String> {
    ldap::test_connection(&config.into()).await.map_err(|e| e.to_string())
}

/// Fetch contacts from LDAP
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn ldap_fetch_contacts(config: LdapConfigInput) -> Result<Vec<ImportedContact>, String> {
    ldap::fetch_contacts(&config.into()).await.map_err(|e| e.to_string())
}
