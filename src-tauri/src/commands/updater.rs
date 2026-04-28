use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const DEFAULT_UPDATER_BASE_URL: &str =
    "https://cdn.jsdelivr.net/gh/zyfi1/sipalyzer@beta/updater";
#[inline]
fn allow_runtime_updater_env_overrides() -> bool {
    cfg!(debug_assertions)
}

#[inline]
fn compiletime_updater_base_url() -> &'static str {
    match option_env!("SIPALYZER_UPDATER_BASE_URL") {
        Some(value) => value,
        None => DEFAULT_UPDATER_BASE_URL,
    }
}

#[derive(Clone, Copy)]
enum ReleaseChannel {
    Beta,
    Rc,
    Main,
}

impl ReleaseChannel {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "beta" => Some(Self::Beta),
            "rc" => Some(Self::Rc),
            "main" => Some(Self::Main),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Beta => "beta",
            Self::Rc => "rc",
            Self::Main => "main",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterReleaseInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

fn updater_pubkey() -> Option<String> {
    // Runtime env overrides are dev-only; release builds rely on tauri.conf updater key.
    let runtime_pubkey = if allow_runtime_updater_env_overrides() {
        std::env::var("SIPALYZER_UPDATER_PUBKEY").ok()
    } else {
        None
    };
    let pubkey = runtime_pubkey.unwrap_or_default();
    let pubkey = pubkey.trim();
    if pubkey.is_empty() {
        return None;
    }
    Some(pubkey.to_string())
}

fn updater_endpoint_for_channel(channel: ReleaseChannel) -> String {
    let runtime_base = if allow_runtime_updater_env_overrides() {
        std::env::var("SIPALYZER_UPDATER_BASE_URL")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    } else {
        None
    };
    let base = runtime_base.unwrap_or_else(|| compiletime_updater_base_url().to_string());
    format!("{}/{}.json", base.trim_end_matches('/'), channel.as_str())
}

fn updater_endpoint_url(channel: ReleaseChannel) -> Result<Url, String> {
    Url::parse(&updater_endpoint_for_channel(channel))
        .map_err(|e| format!("Invalid updater endpoint URL: {e}"))
}

fn parse_channel(channel: &str) -> Result<ReleaseChannel, String> {
    ReleaseChannel::parse(channel)
        .ok_or_else(|| format!("Unsupported channel \"{channel}\". Expected beta, rc, or main."))
}

#[tauri::command]
pub async fn updater_check(
    app: tauri::AppHandle,
    channel: String,
) -> Result<Option<UpdaterReleaseInfo>, String> {
    let release_channel = parse_channel(channel.trim())?;
    let endpoint = updater_endpoint_url(release_channel)?;
    let builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure update endpoint: {e}"))?;
    let builder = if let Some(pubkey) = updater_pubkey() {
        builder.pubkey(pubkey)
    } else {
        builder
    };
    let updater = builder
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))?;

    let maybe_update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    Ok(maybe_update.map(|update| UpdaterReleaseInfo {
        version: update.version.clone(),
        current_version: app.package_info().version.to_string(),
        notes: update.body.clone(),
        published_at: update.date.map(|value| value.to_string()),
    }))
}

#[tauri::command]
pub async fn updater_install(
    app: tauri::AppHandle,
    channel: String,
) -> Result<Option<UpdaterReleaseInfo>, String> {
    let release_channel = parse_channel(channel.trim())?;
    let endpoint = updater_endpoint_url(release_channel)?;
    let builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure update endpoint: {e}"))?;
    let builder = if let Some(pubkey) = updater_pubkey() {
        builder.pubkey(pubkey)
    } else {
        builder
    };
    let updater = builder
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))?;

    let maybe_update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    let Some(update) = maybe_update else {
        return Ok(None);
    };

    let release = UpdaterReleaseInfo {
        version: update.version.clone(),
        current_version: app.package_info().version.to_string(),
        notes: update.body.clone(),
        published_at: update.date.map(|value| value.to_string()),
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update install failed: {e}"))?;

    Ok(Some(release))
}
