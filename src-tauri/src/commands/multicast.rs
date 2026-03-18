use crate::multicast::{join, listener, audio_receiver, audio_sender, igmp};
use crate::multicast::types::*;

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_join_group(
    app: tauri::AppHandle,
    group: String,
    port: u16,
    interface: Option<String>,
) -> Result<JoinResult, String> {
    let result = join::join_group(&group, port, interface.as_deref()).await?;
    if result.success {
        let cancel_rx = join::get_cancel_rx(&group, port)
            .ok_or_else(|| "Failed to get cancel receiver".to_string())?;
        let packet_tx = join::get_packet_tx(&group, port)
            .ok_or_else(|| "Failed to get packet broadcast sender".to_string())?;

        let iface = join::get_interface(&group, port);

        // Use a oneshot to wait for the listener to finish socket setup
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();

        let g = group.clone();
        let iface_clone = iface.clone();
        tokio::spawn(async move {
            match listener::start_listener(
                app,
                &g,
                port,
                iface_clone.as_deref(),
                packet_tx,
                cancel_rx,
                ready_tx,
            ).await {
                Ok(()) => tracing::info!("Listener exited normally for {}:{}", g, port),
                Err(e) => tracing::error!("Listener FAILED for {}:{}: {}", g, port, e),
            }
        });

        // Wait for the listener to report ready (or failure)
        match ready_rx.await {
            Ok(Ok(())) => { /* listener is up and receiving */ }
            Ok(Err(e)) => {
                // Listener failed to start — clean up the joined group
                let _ = join::leave_group(&group).await;
                return Err(format!("Listener failed to start: {}", e));
            }
            Err(_) => {
                let _ = join::leave_group(&group).await;
                return Err("Listener task exited before signaling readiness".to_string());
            }
        }
    }
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_leave_group(group: String) -> Result<LeaveResult, String> {
    join::leave_group(&group).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_leave_group_exact(group: String, port: u16) -> Result<LeaveResult, String> {
    join::leave_group_exact(&group, port).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_list_groups() -> Vec<MulticastGroup> {
    join::list_groups()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_send_test(
    group: String,
    port: u16,
    count: u32,
    interval_ms: u32,
    ttl: Option<u8>,
) -> Result<SendTestResult, String> {
    join::send_test(&group, port, count, interval_ms, ttl).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_igmp_query(
    interface: Option<String>,
) -> Result<IgmpQueryResult, String> {
    let mut result = igmp::send_igmp_query(interface.as_deref()).await?;

    // Also include groups currently joined by this app process.
    // Raw IGMP report capture can miss self-membership depending on OS/network behavior.
    let local_groups = join::list_groups();
    for g in local_groups {
        if let Some(existing) = result.groups_found.iter_mut().find(|r| r.group == g.group) {
            if !existing.compatibility_mode.contains("local app joined") {
                existing.compatibility_mode = format!("{} + local app joined", existing.compatibility_mode);
            }
        } else {
            result.groups_found.push(MulticastGroupReport {
                group: g.group,
                last_reporter: "local-app".to_string(),
                igmp_version: result.igmp_version.max(2),
                compatibility_mode: "local app joined".to_string(),
            });
        }
    }

    result
        .groups_found
        .sort_by(|a, b| a.group.cmp(&b.group));

    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn multicast_snooping_verify(
    group: String,
    interface: Option<String>,
) -> Result<SnoopingVerifyResult, String> {
    igmp::verify_snooping(&group, interface.as_deref()).await
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_stop_listener(group: String, port: u16) -> Result<(), String> {
    let key = format!("{}:{}", group, port);
    let groups = crate::multicast::join::ACTIVE_GROUPS.lock().map_err(|e| e.to_string())?;
    if let Some(g) = groups.get(&key) {
        let _ = g.cancel_tx.send(true);
        Ok(())
    } else {
        Err(format!("No active listener for {}", key))
    }
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_start(
    app: tauri::AppHandle,
    group: String,
    port: u16,
    output_device_id: Option<String>,
    codec: Option<String>,
) -> Result<(), String> {
    let packet_rx = join::subscribe_packets(&group, port)
        .ok_or_else(|| format!("Group {}:{} is not joined — join before starting audio", group, port))?;

    audio_receiver::start(
        app,
        &group,
        port,
        packet_rx,
        output_device_id.as_deref(),
        codec.as_deref(),
    )
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_stop(group: String) -> Result<(), String> {
    audio_receiver::stop(&group)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_set_volume(group: String, volume: f32) -> Result<(), String> {
    audio_receiver::set_volume(&group, volume)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_set_muted(group: String, muted: bool) -> Result<(), String> {
    audio_receiver::set_muted(&group, muted)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_get_waveform(group: String) -> Result<AudioWaveform, String> {
    audio_receiver::get_waveform(&group)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_audio_get_metrics(group: String) -> Result<AudioStreamMetrics, String> {
    audio_receiver::get_metrics(&group)
}

// ── Audio Generator commands ─────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_start(
    group: String,
    port: u16,
    codec: Option<String>,
    source: Option<String>,
    tone: Option<String>,
    frequency: Option<f32>,
    amplitude: Option<f32>,
    input_device_id: Option<String>,
) -> Result<(), String> {
    audio_sender::start(
        &group,
        port,
        codec.as_deref(),
        source.as_deref(),
        tone.as_deref(),
        frequency,
        amplitude,
        input_device_id.as_deref(),
    )
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_stop(group: String) -> Result<(), String> {
    audio_sender::stop(&group)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_set_tone(
    group: String,
    tone: String,
    frequency: Option<f32>,
    amplitude: Option<f32>,
) -> Result<(), String> {
    audio_sender::set_tone_type(&group, &tone)?;
    if let Some(f) = frequency {
        audio_sender::set_frequency(&group, f)?;
    }
    if let Some(a) = amplitude {
        audio_sender::set_amplitude(&group, a)?;
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_get_state(group: String) -> Result<AudioGeneratorState, String> {
    audio_sender::get_state(&group)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_get_metrics(group: String) -> Result<AudioGeneratorMetrics, String> {
    audio_sender::get_metrics(&group)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_list() -> Vec<AudioGeneratorState> {
    audio_sender::list_active()
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_set_source(
    group: String,
    source: String,
    device_id: Option<String>,
) -> Result<(), String> {
    audio_sender::set_source_mode(&group, &source, device_id.as_deref())
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_feed_tts(
    group: String,
    samples: Vec<i16>,
) -> Result<(), String> {
    audio_sender::feed_tts_pcm(&group, &samples)
}

#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn multicast_generate_set_input_gain(
    group: String,
    gain: f32,
) -> Result<(), String> {
    audio_sender::set_input_gain(&group, gain)
}
