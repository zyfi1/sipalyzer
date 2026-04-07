//! Tauri commands for softphone media engine (start/stop/mute).
//! Used by the call controller when a call is answered.

use crate::softphone;
use tauri::command;

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_start_media(
    call_id: String,
    local_rtp_port: u16,
    remote_rtp_address: String,
    remote_rtp_port: u16,
    input_device_id: Option<String>,
    output_device_id: Option<String>,
    jitter_buffer_min_ms: u32,
    jitter_buffer_max_ms: u32,
    negotiated_codec: Option<String>,
    negotiated_pt: Option<u8>,
    moh_preset: Option<String>,
    input_gain: Option<f32>,
) -> Result<(), String> {
    softphone::start_media(
        call_id,
        local_rtp_port,
        &remote_rtp_address,
        remote_rtp_port,
        input_device_id,
        output_device_id,
        jitter_buffer_min_ms,
        jitter_buffer_max_ms,
        negotiated_codec,
        negotiated_pt,
        moh_preset,
        input_gain.unwrap_or(1.0),
    )
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_set_input_gain(call_id: String, input_gain: f32) -> Result<(), String> {
    softphone::set_input_gain(&call_id, input_gain)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_stop_media(call_id: String) -> Result<(), String> {
    softphone::stop_media(&call_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_set_muted(call_id: String, muted: bool) -> Result<(), String> {
    softphone::set_muted(&call_id, muted)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_set_audio_devices(
    call_id: String,
    input_device_id: Option<String>,
    output_device_id: Option<String>,
) -> Result<(), String> {
    softphone::set_audio_devices(&call_id, input_device_id, output_device_id)
}

#[derive(serde::Serialize)]
pub struct CallMetricsResult {
    pub mos: f64,
    pub jitter_ms: f64,
    pub send_peak: f32,
    pub recv_peak: f32,
    pub loss_percent: f64,
    pub lost_packets: u64,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_get_call_metrics(call_id: String) -> Result<CallMetricsResult, String> {
    let (mos, jitter_ms, send_peak, recv_peak, loss_percent, lost_packets) =
        softphone::get_call_metrics(&call_id)?;
    Ok(CallMetricsResult {
        mos,
        jitter_ms,
        send_peak,
        recv_peak,
        loss_percent,
        lost_packets,
    })
}

#[derive(serde::Serialize)]
pub struct CallJitterHistoryResult {
    pub timestamps_sec: Vec<f64>,
    pub jitter_ms: Vec<f64>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_get_call_jitter_history(
    call_id: String,
) -> Result<CallJitterHistoryResult, String> {
    let (t, j) = softphone::get_call_jitter_history(&call_id)?;
    Ok(CallJitterHistoryResult {
        timestamps_sec: t,
        jitter_ms: j,
    })
}

#[derive(serde::Serialize)]
pub struct CallWaveformResult {
    pub send: Vec<f32>,
    pub recv: Vec<f32>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn softphone_get_call_waveform(call_id: String) -> Result<CallWaveformResult, String> {
    let (send, recv) = softphone::get_call_waveform(&call_id)?;
    Ok(CallWaveformResult { send, recv })
}
