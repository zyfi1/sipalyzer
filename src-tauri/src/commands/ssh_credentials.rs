use tauri::command;

use crate::core::credentials::CredentialStore;
use crate::core::database::Database;

fn ssh_password_key(connection_id: &str) -> String {
    format!("ssh_password:{}", connection_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn set_ssh_connection_password(connection_id: String, password: String) -> Result<(), String> {
    let encrypted = CredentialStore::encrypt_password(&password)
        .map_err(|e| format!("Failed to encrypt SSH password: {}", e))?;
    let key = ssh_password_key(&connection_id);
    Database::set_session_value(&key, &encrypted)
        .map_err(|e| format!("Failed to persist SSH password: {}", e))?;
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_ssh_connection_password(connection_id: String) -> Result<Option<String>, String> {
    let key = ssh_password_key(&connection_id);
    let stored = Database::get_session_value(&key)
        .map_err(|e| format!("Failed to load SSH password: {}", e))?;
    match stored {
        Some(encrypted) => {
            let decrypted = CredentialStore::decrypt_password(&encrypted)
                .map_err(|e| format!("Failed to decrypt SSH password: {}", e))?;
            Ok(Some(decrypted))
        }
        None => Ok(None),
    }
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_ssh_connection_password(connection_id: String) -> Result<(), String> {
    let key = ssh_password_key(&connection_id);
    Database::delete_session_value(&key)
        .map_err(|e| format!("Failed to delete SSH password: {}", e))?;
    Ok(())
}
