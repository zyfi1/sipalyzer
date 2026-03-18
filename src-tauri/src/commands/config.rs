use crate::core::config;
use crate::core::database::Database;
use crate::core::user_agent;
use tauri::command;

#[command]
#[tracing::instrument(skip_all)]
pub fn get_config_dir() -> Result<String, String> {
    config::get_config_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn load_config() -> Result<config::AppConfig, String> {
    // Load from encrypted database
    let registrars = Database::load_registrars()
        .map_err(|e| e.to_string())?;
    let global_settings = Database::load_global_settings()
        .map_err(|e| e.to_string())?;
    
    Ok(config::AppConfig {
        registrars,
        global_settings,
    })
}

#[command]
#[tracing::instrument(skip_all)]
pub fn save_config(app_config: config::AppConfig) -> Result<(), String> {
    Database::save_global_settings(&app_config.global_settings)
        .map_err(|e| e.to_string())?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "settings", "save_config", "user", None, None,
    );

    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_default_user_agent() -> Result<String, String> {
    Ok(user_agent::default_user_agent())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_minimal_user_agent() -> Result<String, String> {
    Ok(user_agent::minimal_user_agent())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn set_app_user_agent(override_value: Option<String>) {
    user_agent::set_app_user_agent(override_value);
}

#[command]
#[tracing::instrument(skip_all)]
pub fn set_include_username_in_user_agent(include: bool) {
    user_agent::set_include_username_in_user_agent(include);
}
