use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const DEFAULT_UPDATER_BASE_URL: &str = "https://raw.githubusercontent.com/zyfi1/sipalyzer/beta/updater";

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

fn updater_pubkey() -> Result<String, String> {
    // Prefer runtime env for local/dev smoke tests; fall back to compile-time embed.
    let pubkey = std::env::var("SIPALYZER_UPDATER_PUBKEY")
        .ok()
        .unwrap_or_else(|| option_env!("SIPALYZER_UPDATER_PUBKEY").unwrap_or("").to_string());
    let pubkey = pubkey.trim();
    if pubkey.is_empty() {
        return Err(
            "Updater is not configured yet. Missing SIPALYZER_UPDATER_PUBKEY (runtime or build-time)."
                .to_string(),
        );
    }
    Ok(pubkey.to_string())
}

fn updater_endpoint_for_channel(channel: ReleaseChannel) -> String {
    let base = std::env::var("SIPALYZER_UPDATER_BASE_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATER_BASE_URL.to_string());
    format!(
        "{}/{}.json",
        base.trim_end_matches('/'),
        channel.as_str()
    )
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
    let pubkey = updater_pubkey()?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure update endpoint: {e}"))?
        .pubkey(pubkey)
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
    let pubkey = updater_pubkey()?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure update endpoint: {e}"))?
        .pubkey(pubkey)
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
