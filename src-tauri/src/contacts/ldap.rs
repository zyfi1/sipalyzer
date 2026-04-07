//! LDAP/Active Directory contact import
//!
//! Uses ldap3 crate to connect to LDAP directories.

use super::ImportedContact;
use anyhow::{anyhow, Result};
use ldap3::{LdapConnAsync, Scope, SearchEntry};
use serde::{Deserialize, Serialize};

/// LDAP connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LdapConfig {
    /// LDAP server URL (e.g., "ldap://ldap.example.com" or "ldaps://ldap.example.com:636")
    pub server_url: String,
    /// Base DN for searches (e.g., "dc=example,dc=com")
    pub base_dn: String,
    /// Bind DN (optional, for authenticated searches)
    pub bind_dn: Option<String>,
    /// Bind password
    pub bind_password: Option<String>,
    /// Search filter (default: "(objectClass=person)")
    pub search_filter: Option<String>,
    /// Use TLS/STARTTLS
    pub use_tls: bool,
}

impl Default for LdapConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            base_dn: String::new(),
            bind_dn: None,
            bind_password: None,
            search_filter: Some("(objectClass=person)".to_string()),
            use_tls: true,
        }
    }
}

/// Fetch contacts from LDAP directory
pub async fn fetch_contacts(config: &LdapConfig) -> Result<Vec<ImportedContact>> {
    // Connect to LDAP server
    let (conn, mut ldap) = LdapConnAsync::new(&config.server_url).await?;
    ldap3::drive!(conn);

    // Bind if credentials provided
    if let (Some(bind_dn), Some(password)) = (&config.bind_dn, &config.bind_password) {
        ldap.simple_bind(bind_dn, password)
            .await?
            .success()
            .map_err(|e| anyhow!("LDAP bind failed: {:?}", e))?;
    }

    // Search for contacts
    let filter = config
        .search_filter
        .as_deref()
        .unwrap_or("(objectClass=person)");

    // Attributes to fetch
    let attrs = vec![
        "cn",              // Common Name
        "displayName",     // Display Name
        "givenName",       // First Name
        "sn",              // Surname
        "telephoneNumber", // Phone
        "mobile",          // Mobile Phone
        "mail",            // Email
        "o",               // Organization
        "company",         // Company (AD)
        "description",     // Notes
    ];

    let (results, _res) = ldap
        .search(&config.base_dn, Scope::Subtree, filter, attrs)
        .await?
        .success()
        .map_err(|e| anyhow!("LDAP search failed: {:?}", e))?;

    ldap.unbind().await?;

    // Parse results
    let mut contacts = Vec::new();
    for result in results {
        let entry = SearchEntry::construct(result);
        if let Some(contact) = parse_ldap_entry(&entry) {
            contacts.push(contact);
        }
    }

    Ok(contacts)
}

/// Test LDAP connection
pub async fn test_connection(config: &LdapConfig) -> Result<String> {
    let (conn, mut ldap) = LdapConnAsync::new(&config.server_url)
        .await
        .map_err(|e| anyhow!("Connection failed: {}", e))?;

    ldap3::drive!(conn);

    // Try to bind
    if let (Some(bind_dn), Some(password)) = (&config.bind_dn, &config.bind_password) {
        ldap.simple_bind(bind_dn, password)
            .await?
            .success()
            .map_err(|e| anyhow!("Bind failed: {:?}", e))?;
    }

    // Do a quick search to verify base DN
    let (results, _) = ldap
        .search(&config.base_dn, Scope::Base, "(objectClass=*)", vec!["dn"])
        .await?
        .success()
        .map_err(|e| anyhow!("Search failed: {:?}", e))?;

    ldap.unbind().await?;

    Ok(format!(
        "Connected successfully. Found {} base entries.",
        results.len()
    ))
}

fn parse_ldap_entry(entry: &SearchEntry) -> Option<ImportedContact> {
    // Get name - try displayName, then cn, then construct from givenName + sn
    let name = get_first_attr(&entry.attrs, "displayName")
        .or_else(|| get_first_attr(&entry.attrs, "cn"))
        .or_else(|| {
            let first = get_first_attr(&entry.attrs, "givenName").unwrap_or_default();
            let last = get_first_attr(&entry.attrs, "sn").unwrap_or_default();
            let full = format!("{} {}", first, last).trim().to_string();
            if full.is_empty() {
                None
            } else {
                Some(full)
            }
        })?;

    // Get phone - try mobile first, then telephoneNumber
    let phone = get_first_attr(&entry.attrs, "mobile")
        .or_else(|| get_first_attr(&entry.attrs, "telephoneNumber"))?;

    // Get email
    let email = get_first_attr(&entry.attrs, "mail");

    // Get company/organization
    let company =
        get_first_attr(&entry.attrs, "company").or_else(|| get_first_attr(&entry.attrs, "o"));

    // Get notes
    let notes = get_first_attr(&entry.attrs, "description");

    Some(ImportedContact {
        name,
        phone,
        email,
        company,
        notes,
    })
}

fn get_first_attr(
    attrs: &std::collections::HashMap<String, Vec<String>>,
    key: &str,
) -> Option<String> {
    attrs
        .get(key)
        .and_then(|v| v.first())
        .filter(|s| !s.is_empty())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = LdapConfig::default();
        assert_eq!(
            config.search_filter,
            Some("(objectClass=person)".to_string())
        );
        assert!(config.use_tls);
    }
}
