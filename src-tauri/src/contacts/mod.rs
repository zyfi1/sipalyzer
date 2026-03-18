//! Contact import functionality for LDAP integration.

pub mod ldap;

use serde::{Deserialize, Serialize};

/// Contact data structure for import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedContact {
    pub name: String,
    pub phone: String,
    pub email: Option<String>,
    pub company: Option<String>,
    pub notes: Option<String>,
}
