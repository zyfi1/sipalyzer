//! App-wide User-Agent for SIP/HTTP: version + platform info for audit.
//! Frontend can override via set_app_user_agent(); otherwise default is used.
//! Format: SIPalyzer/{version} (macOS 14.2.1) or SIPalyzer/{version} (macOS 14.2.1; username) when user is available.

use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::process::Command;

static OVERRIDE: Mutex<Option<String>> = Mutex::new(None);
/// When true (default), default_user_agent() includes OS username when available.
static INCLUDE_USERNAME: Mutex<bool> = Mutex::new(true);

/// OS display string: "macOS 14.2.1", "Windows", or "Linux".
fn os_display() -> String {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("sw_vers")
            .arg("-productVersion")
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !v.is_empty() {
                    return format!("macOS {}", v);
                }
            }
        }
        "macOS".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        "Windows".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::consts::OS.to_string()
    }
}

/// Current OS user if available (USER, LOGNAME on Unix; USERNAME on Windows).
fn os_username() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("USERNAME").ok()
    }
    #[cfg(not(windows))]
    {
        std::env::var("USER")
            .ok()
            .or_else(|| std::env::var("LOGNAME").ok())
            .filter(|s| !s.is_empty())
    }
}

/// Build default User-Agent: SIPalyzer/{version} (OS version) or with ; username when include_username is true.
pub fn default_user_agent() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let os = os_display();
    let include_user = INCLUDE_USERNAME.lock().map(|g| *g).unwrap_or(true);
    if !include_user {
        return format!("SIPalyzer/{} ({})", version, os);
    }
    match os_username() {
        Some(u) if !u.is_empty() => {
            let safe = u
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .take(32)
                .collect::<String>();
            if safe.is_empty() {
                format!("SIPalyzer/{} ({})", version, os)
            } else {
                format!("SIPalyzer/{} ({}; {})", version, os, safe)
            }
        }
        _ => format!("SIPalyzer/{} ({})", version, os),
    }
}

/// Minimal User-Agent: SIPalyzer/{version} only.
pub fn minimal_user_agent() -> String {
    format!("SIPalyzer/{}", env!("CARGO_PKG_VERSION"))
}

/// Set whether default User-Agent includes OS username. Frontend syncs this from Settings.
pub fn set_include_username_in_user_agent(include: bool) {
    if let Ok(mut guard) = INCLUDE_USERNAME.lock() {
        *guard = include;
    }
}

/// Effective User-Agent: override if set, else default.
pub fn get_effective_user_agent() -> String {
    if let Ok(guard) = OVERRIDE.lock() {
        if let Some(ref s) = *guard {
            if !s.is_empty() {
                return s.clone();
            }
        }
    }
    default_user_agent()
}

/// Set app-wide User-Agent override. None or empty = use default.
pub fn set_app_user_agent(override_value: Option<String>) {
    if let Ok(mut guard) = OVERRIDE.lock() {
        *guard = override_value.filter(|s| !s.is_empty());
    }
}
