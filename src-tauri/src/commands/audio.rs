//! Audio device enumeration for the host OS (microphone and speaker selection).
//! Uses cpal for cross-platform device listing (macOS CoreAudio, Windows WASAPI, Linux ALSA).

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use tauri::command;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn list_audio_input_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .map(|s| s.to_string());
    let devices: Vec<AudioDevice> = host
        .input_devices()
        .map_err(|e| format!("Failed to list input devices: {}", e))?
        .filter_map(|d| {
            let name = d.name().unwrap_or_else(|_| "Unknown".to_string());
            let id = name.clone();
            let is_default = default_name.as_ref().map(|n| n == &name).unwrap_or(false);
            Some(AudioDevice {
                id,
                name,
                is_default,
            })
        })
        .collect();
    // If none marked default, mark first
    let mut devices = devices;
    if !devices.is_empty() && !devices.iter().any(|d| d.is_default) {
        devices.first_mut().unwrap().is_default = true;
    }
    Ok(devices)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn list_audio_output_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .map(|s| s.to_string());
    let devices: Vec<AudioDevice> = host
        .output_devices()
        .map_err(|e| format!("Failed to list output devices: {}", e))?
        .filter_map(|d| {
            let name = d.name().unwrap_or_else(|_| "Unknown".to_string());
            let id = name.clone();
            let is_default = default_name.as_ref().map(|n| n == &name).unwrap_or(false);
            Some(AudioDevice {
                id,
                name,
                is_default,
            })
        })
        .collect();
    let mut devices = devices;
    if !devices.is_empty() && !devices.iter().any(|d| d.is_default) {
        devices.first_mut().unwrap().is_default = true;
    }
    Ok(devices)
}
