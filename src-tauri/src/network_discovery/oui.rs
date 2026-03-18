//! OUI (Organizationally Unique Identifier) vendor lookup.
//!
//! Embeds the **full** IEEE OUI database (~39 000 entries, compiled from
//! <https://standards-oui.ieee.org/oui/oui.csv>).  The TSV file lives
//! next to this source file and is pulled in at compile time via
//! `include_str!`, so there is zero runtime I/O.

use std::collections::HashMap;
use once_cell::sync::Lazy;

/// Full IEEE OUI database embedded at compile time.
static OUI_TSV: &str = include_str!("oui_data.tsv");

/// Parsed lookup table: "AA:BB:CC" → "Vendor Name"
static OUI_DB: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::with_capacity(40_000);
    for line in OUI_TSV.lines() {
        if let Some((prefix, name)) = line.split_once('\t') {
            m.insert(prefix, name);
        }
    }
    m
});

/// Lookup the vendor name from a MAC address.
///
/// The MAC can be in any common format:
///   - `AA:BB:CC:DD:EE:FF`  (colon-separated)
///   - `AA-BB-CC-DD-EE-FF`  (dash-separated)
///   - `AABB.CCDD.EEFF`     (Cisco dot notation)
///
/// Returns `None` if the OUI prefix is not in the database.
pub fn lookup_oui(mac: &str) -> Option<String> {
    // Strip everything except hex digits, uppercase
    let clean: String = mac
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();

    if clean.len() < 6 {
        return None;
    }

    let prefix = format!("{}:{}:{}", &clean[0..2], &clean[2..4], &clean[4..6]);
    OUI_DB.get(prefix.as_str()).map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_loaded() {
        // Ensure the DB has a reasonable number of entries
        assert!(OUI_DB.len() > 30_000, "OUI DB should have 30k+ entries, got {}", OUI_DB.len());
    }

    #[test]
    fn test_lookup_known_vendor() {
        assert_eq!(lookup_oui("00:50:56:ab:cd:ef"), Some("VMware".to_string()));
        assert_eq!(lookup_oui("B8:27:EB:11:22:33"), Some("Raspberry Pi Foundation".to_string()));
    }

    #[test]
    fn test_lookup_dash_format() {
        assert_eq!(lookup_oui("00-50-56-AB-CD-EF"), Some("VMware".to_string()));
    }

    #[test]
    fn test_lookup_unknown() {
        assert_eq!(lookup_oui("FF:FF:00:11:22:33"), None);
    }

    #[test]
    fn test_lookup_short_mac() {
        assert_eq!(lookup_oui("AA:BB"), None);
    }
}
