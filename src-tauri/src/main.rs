// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Limit dead_code allowance to debug builds while keeping other warnings visible.
#![cfg_attr(debug_assertions, allow(dead_code))]

mod contacts;
mod core;
mod sip;
mod commands;
mod packet_capture;
mod softphone;
mod spandsp;
mod network_test;
mod sip_discovery;
mod network_discovery;
mod remote_agent;
mod multicast;
mod mcp;

use commands::admin as admin_commands;
use commands::audio;
use commands::crafter;
use commands::contacts as contacts_commands;
use commands::dns as dns_commands;
use commands::fax;
use commands::provision;
use commands::registration;
use commands::config;
use commands::notes;
use commands::session_state;
use commands::packet_capture as packet_capture_commands;
use commands::softphone_media as softphone_media_commands;
use commands::softphone as softphone_commands;
use commands::network_test as network_test_commands;
use commands::sip_discovery as sip_discovery_commands;
use commands::network_devices as network_devices_commands;
use commands::speech as speech_commands;
use commands::terminal as terminal_commands;
use commands::ssh_credentials as ssh_credentials_commands;
use commands::remote_agent as remote_agent_commands;
use commands::tools as tools_commands;
use commands::multicast as multicast_commands;
use commands::mcp as mcp_commands;
use commands::updater as updater_commands;
use packet_capture::scheduler::ScheduledCaptureScheduler;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;

use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use once_cell::sync::Lazy;

/// Stores file paths passed via OS file association (double-clicking .pcap files)
static PENDING_FILE_OPEN: Lazy<StdMutex<Vec<String>>> = Lazy::new(|| StdMutex::new(Vec::new()));

/// When true, closing the window hides it to the system tray instead of quitting.
/// Controlled by the frontend settings and synced via `set_minimize_to_tray`.
static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

/// When true, the app hides from the dock (macOS) or taskbar (Windows/Linux),
/// appearing only in the system tray / menu bar.
static HIDE_DOCK_ICON: AtomicBool = AtomicBool::new(false);

/// When true, show the system tray / menu bar icon. Defaults to true.
/// Controlled by the frontend settings and synced via `set_show_tray_icon`.
static SHOW_TRAY_ICON: AtomicBool = AtomicBool::new(true);

fn build_main_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show_item = MenuItem::with_id(app, "show", "Show SIPalyzer", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit SIPalyzer", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&show_item, &hide_item, &separator, &quit_item],
    )
}

pub(crate) fn open_remote_chat_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("remote-chat") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        "remote-chat",
        WebviewUrl::App("index.html".into()),
    )
    .title("Remote Chat")
    .inner_size(420.0, 620.0)
    .min_inner_size(360.0, 480.0)
    .always_on_top(true)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create remote chat window: {e}"))?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

pub(crate) fn refresh_remote_chat_tray(app: &tauri::AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("SIPalyzer".to_string()));
        if let Ok(menu) = build_main_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Called by the frontend to check if the app was opened with a file association.
/// Returns and clears pending file paths.
#[tauri::command]
fn get_pending_file_open() -> Vec<String> {
    let mut pending = PENDING_FILE_OPEN.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *pending)
}

#[tauri::command]
fn set_minimize_to_tray(enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn set_show_tray_icon(app: tauri::AppHandle, enabled: bool) {
    SHOW_TRAY_ICON.store(enabled, Ordering::SeqCst);
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_visible(enabled);
    }
}

/// Run all backend cleanup: end calls, stop captures, unregister SIP.
/// Called by the frontend when it's ready to shut down (after confirmation + session save).
#[tauri::command]
fn perform_app_cleanup() {
    tracing::info!("Performing backend cleanup...");
    softphone::end_all_active_calls();
    packet_capture_commands::stop_all_captures();
    packet_capture::remote_capture::stop_all_remote_captures();
    tauri::async_runtime::block_on(async {
        crate::commands::remote_agent::remote_agent_stop_all_relays().await;
        if let Err(err) = crate::remote_agent::server::stop_all_listeners().await {
            tracing::warn!("Remote agent listener cleanup failed: {}", err);
        }
    });

    if let Ok(registrars) = core::database::Database::load_registrars() {
        for r in &registrars {
            let password = match core::credentials::CredentialStore::decrypt_password(&r.password) {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("Cannot decrypt password for {}: {}", r.name, e);
                    continue;
                }
            };
            let mut config = r.clone();
            config.password = password;
            config.timeout_seconds = std::cmp::min(config.timeout_seconds, 5);
            config.retry_count = 0;

            match sip::register::RegistrationTester::test_registration_with_expires(&config, 0) {
                Ok(_) => tracing::info!("Unregistered {}", r.name),
                Err(e) => tracing::error!("Failed to unregister {}: {}", r.name, e),
            }
        }
    }
    tracing::info!("Backend cleanup complete");
}

/// Final exit — called by frontend after cleanup is done.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    tracing::info!("Exiting application");
    app.exit(0);
}

/// Hide the app from the dock (macOS) or taskbar (Windows/Linux).
/// On macOS this uses activation policy; on Windows/Linux it uses skip_taskbar.
#[tauri::command]
fn set_hide_dock_icon(app: tauri::AppHandle, enabled: bool) {
    HIDE_DOCK_ICON.store(enabled, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        if enabled {
            let _ = app.set_activation_policy(ActivationPolicy::Accessory);
        } else {
            let _ = app.set_activation_policy(ActivationPolicy::Regular);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_skip_taskbar(enabled);
        }
    }
}

/// Returns the current OS so the frontend can show platform-specific labels.
#[tauri::command]
fn get_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    { "macos" }
    #[cfg(target_os = "windows")]
    { "windows" }
    #[cfg(target_os = "linux")]
    { "linux" }
}

/// Import a PCAP from base64-encoded data (used by remote agent tools).
/// Writes to a temp file, imports into the capture database, and returns the session ID.
#[tauri::command]
fn import_pcap_from_base64(base64_data: String, name: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let tmp_dir = std::env::temp_dir();
    let tmp_path = tmp_dir.join(format!("sipalyzer-remote-{}.pcap", uuid::Uuid::new_v4()));
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed to write temp PCAP: {}", e))?;

    let result = import_pcap_from_path_inner(&tmp_path.to_string_lossy(), Some(&name));
    let _ = std::fs::remove_file(&tmp_path);
    result
}

/// Import a pcap file from a specific path (used for file association handling).
/// Unlike import_pcap which opens a file dialog, this takes a direct path.
#[tauri::command]
fn import_pcap_from_path(file_path: String) -> Result<String, String> {
    import_pcap_from_path_inner(&file_path, None)
}

/// Shared import logic: validates a PCAP on disk, copies into app storage,
/// creates a database session record, and returns the session ID.
fn import_pcap_from_path_inner(file_path: &str, custom_name: Option<&str>) -> Result<String, String> {
    use crate::core::config;
    use crate::core::database;
    use uuid::Uuid;
    use crate::packet_capture::FilterConfig;
    use pcap::Capture;

    let source_path = std::path::PathBuf::from(file_path);
    if !source_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Validate pcap
    let cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Not a valid PCAP file: {}", e))?;
    drop(cap);

    // Count packets and verify parser compatibility.
    let mut cap = Capture::from_file(&source_path)
        .map_err(|e| format!("Failed to read PCAP file: {}", e))?;
    let link_layer_type = cap.get_datalink().0 as u32;
    let parser = crate::packet_capture::packet_parser::PacketParser::with_rtp_port_range(
        link_layer_type,
        FilterConfig::default().rtp_port_range,
    );
    let mut packet_count: u64 = 0;
    let mut parsed_packet_count: u64 = 0;
    while let Ok(packet) = cap.next_packet() {
        packet_count += 1;
        if parser.parse(&packet, Some(packet_count)).is_some() {
            parsed_packet_count += 1;
        }
    }
    drop(cap);

    let id = Uuid::new_v4().to_string();
    let config_dir = config::get_config_dir().map_err(|e| e.to_string())?;
    let captures_dir = config_dir.join("captures");
    std::fs::create_dir_all(&captures_dir).map_err(|e| e.to_string())?;
    let dest_path = captures_dir.join(format!("{}.pcap", id));

    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy PCAP file: {}", e))?;

    let session_name = if let Some(name) = custom_name {
        name.to_string()
    } else {
        source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| format!("Imported: {}", s))
            .unwrap_or_else(|| "Imported capture".to_string())
    };

    let filter_config = FilterConfig::default();
    let filter_config_json = serde_json::to_string(&filter_config).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let conn = database::Database::get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO capture_sessions (id, name, description, interface, filter_config, start_time, status, packet_count, file_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            session_name,
            format!(
                "Imported from {} ({} parsed / {} total)",
                source_path.display(),
                parsed_packet_count,
                packet_count
            ),
            "imported",
            filter_config_json,
            now,
            "Imported",
            parsed_packet_count,
            dest_path.to_string_lossy(),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "PCAP: {} → session {} ({} parsed / {} total packets)",
        file_path,
        id,
        parsed_packet_count,
        packet_count
    );
    Ok(id)
}

/// Restore window-behavior flags from the session state DB.
/// Must run before Tauri initializes so macOS never shows a dock icon if the user disabled it.
fn restore_window_prefs_early() {
    if let Ok(Some(json)) = core::database::Database::get_session_value("state") {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(settings) = parsed.get("settings") {
                if settings.get("minimizeToTray").and_then(|v| v.as_bool()).unwrap_or(false) {
                    MINIMIZE_TO_TRAY.store(true, Ordering::SeqCst);
                }
                if settings.get("hideDockIcon").and_then(|v| v.as_bool()).unwrap_or(false) {
                    HIDE_DOCK_ICON.store(true, Ordering::SeqCst);
                }
                if let Some(false) = settings.get("showTrayIcon").and_then(|v| v.as_bool()) {
                    SHOW_TRAY_ICON.store(false, Ordering::SeqCst);
                }
            }
        }
    }
}

/// Set macOS activation policy before NSApplication is fully initialized.
/// Uses raw ObjC runtime FFI so we don't need the `cocoa` crate.
#[cfg(target_os = "macos")]
fn apply_macos_activation_policy_early() {
    if !HIDE_DOCK_ICON.load(Ordering::SeqCst) {
        return;
    }
    // NSApplicationActivationPolicyAccessory = 1
    unsafe {
        #[link(name = "AppKit", kind = "framework")]
        extern "C" { fn NSApplicationLoad() -> bool; }
        extern "C" {
            fn objc_getClass(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
            fn sel_registerName(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
            fn objc_msgSend(obj: *mut std::ffi::c_void, sel: *mut std::ffi::c_void, ...)
                -> *mut std::ffi::c_void;
        }

        NSApplicationLoad();
        let cls = objc_getClass(b"NSApplication\0".as_ptr() as *const _);
        let shared_sel = sel_registerName(b"sharedApplication\0".as_ptr() as *const _);
        let app = objc_msgSend(cls, shared_sel);
        let policy_sel = sel_registerName(b"setActivationPolicy:\0".as_ptr() as *const _);
        objc_msgSend(app, policy_sel, 1i64); // 1 = Accessory
        tracing::info!("Set macOS activation policy to Accessory (before Tauri init)");
    }
}

fn main() {
    // Restore window prefs from DB before Tauri starts — prevents dock icon flash on macOS.
    restore_window_prefs_early();
    #[cfg(target_os = "macos")]
    apply_macos_activation_policy_early();

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Always prevent the native close — the frontend orchestrates shutdown.
                    api.prevent_close();

                    if MINIMIZE_TO_TRAY.load(Ordering::SeqCst) {
                        let _ = window.hide();
                        return;
                    }

                    // Tell the frontend to handle the close (confirmation, save, cleanup).
                    let _ = window.emit("app:close-requested", ());
                }
                _ => {}
            }
        })
        .setup(|app| {
            // ── Apply Windows/Linux taskbar hiding (flags already set in restore_window_prefs_early) ──
            #[cfg(not(target_os = "macos"))]
            {
                if HIDE_DOCK_ICON.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_skip_taskbar(true);
                    }
                }
            }

            // Check for file association args (e.g. user double-clicked a .pcap file)
            let args: Vec<String> = std::env::args().collect();
            for arg in args.iter().skip(1) {
                let path = std::path::Path::new(arg);
                if path.exists() {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if matches!(ext, "pcap" | "pcapng" | "cap") {
                        tracing::info!("App opened with file: {}", arg);
                        if let Ok(mut pending) = PENDING_FILE_OPEN.lock() {
                            pending.push(arg.clone());
                        }
                    }
                }
            }

            // Configure the main window for macOS
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title("SIPalyzer").expect("Failed to set window title");
                }
            }
            
            // ── System tray icon (all platforms) ─────────────────────
            {
                let menu = build_main_tray_menu(&app.handle().clone())?;

                let mut tray_builder = TrayIconBuilder::with_id("main")
                    .show_menu_on_left_click(true)
                    .tooltip("SIPalyzer")
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            "hide" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.hide();
                                }
                            }
                            "quit" => {
                                // Ask the frontend to orchestrate shutdown
                                // (confirmation dialog, session save, then cleanup).
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("app:request-quit", ());
                                } else {
                                    // No frontend window — hard exit with cleanup
                                    perform_app_cleanup();
                                    app.exit(0);
                                }
                            }
                            _ => {}
                        }
                    });

                #[cfg(target_os = "macos")]
                {
                    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))
                        .expect("failed to load macOS tray template icon");
                    tray_builder = tray_builder.icon(tray_icon).icon_as_template(true);
                }
                #[cfg(not(target_os = "macos"))]
                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }
                #[cfg(not(target_os = "macos"))]
                {
                    tray_builder = tray_builder.icon_as_template(false);
                }

                let _tray = tray_builder.build(app)?;

                if !SHOW_TRAY_ICON.load(Ordering::SeqCst) {
                    let _ = _tray.set_visible(false);
                }
                refresh_remote_chat_tray(&app.handle().clone());
            }

            // Initialize scheduled capture scheduler
            let scheduler = ScheduledCaptureScheduler::new();
            app.manage(scheduler.clone());
            
            // Start scheduler after app is ready - use std::thread to ensure runtime is initialized
            let scheduler_clone = scheduler.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Wait a bit for Tauri's runtime to be ready
                std::thread::sleep(std::time::Duration::from_millis(500));
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = scheduler_clone.start().await {
                        tracing::error!("Failed to start scheduler: {}", e);
                    }
                });

                // Remote agent connections are now relay-only (via Cloudflare Worker).
                // No local listener is needed at startup.
                let _ = app_handle;
            });
            
            // Initialise the global SIP message log emitter so call_controller
            // and inbound can push events to the frontend without an AppHandle arg.
            softphone::sip_log::init(app.handle().clone());

            let _ = core::audit::AuditWriter::write_entry(
                "system", "app_start", "system", None, None,
            );

            const AUDIT_RETENTION_DAYS: i64 = 7;
            if let Ok(pruned) = core::audit::AuditWriter::prune_old_entries(AUDIT_RETENTION_DAYS) {
                if pruned > 0 {
                    let _ = core::audit::AuditWriter::write_entry(
                        "system", "audit_prune", "system", None,
                        Some(&format!("Removed {} entries older than {} days", pruned, AUDIT_RETENTION_DAYS)),
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Admin commands
            admin_commands::admin_has_password,
            admin_commands::admin_set_password,
            admin_commands::admin_verify_password,
            admin_commands::admin_audit_write,
            admin_commands::admin_audit_query,
            admin_commands::admin_audit_verify_chain,
            admin_commands::admin_audit_stats,
            admin_commands::admin_audit_clear,
            admin_commands::admin_audit_categories,
            admin_commands::admin_audit_actions,
            admin_commands::admin_list_processes,
            admin_commands::admin_kill_process,
            admin_commands::admin_clear_process,
            admin_commands::admin_clear_finished_processes,
            admin_commands::admin_kill_all_processes,
            admin_commands::admin_clear_all_processes,
            admin_commands::admin_clear_events,
            admin_commands::admin_list_feature_flags,
            admin_commands::admin_set_feature_flag,
            admin_commands::admin_get_feature_flag,
            admin_commands::admin_get_system_health,
            admin_commands::admin_list_tables,
            admin_commands::admin_run_query,
            admin_commands::admin_vacuum_db,
            admin_commands::admin_get_db_info,
            // File association commands
            get_pending_file_open,
            // Window behavior
            set_minimize_to_tray,
            set_hide_dock_icon,
            set_show_tray_icon,
            get_platform,
            perform_app_cleanup,
            exit_app,
            updater_commands::updater_check,
            updater_commands::updater_install,
            import_pcap_from_path,
            import_pcap_from_base64,
            // Config commands
            config::get_config_dir,
            config::load_config,
            config::save_config,
            config::get_default_user_agent,
            config::get_minimal_user_agent,
            config::set_app_user_agent,
            config::set_include_username_in_user_agent,
            // Session state (SQLite-backed)
            session_state::pull_session_state,
            session_state::push_session_state,
            // Registration commands
            registration::create_registrar,
            registration::update_registrar,
            registration::get_registrar_password,
            registration::delete_registrar,
            registration::list_registrars,
            registration::test_registration,
            registration::test_registration_with_capture,
            registration::get_registration_status,
            registration::get_registration_logs,
            registration::export_logs,
            registration::check_local_port,
            registration::get_default_local_port,
            // Test suite commands
            registration::run_test_suite,
            registration::bulk_test_registrars,
            registration::bulk_register,
            registration::unregister_registrar,
            registration::bulk_unregister,
            registration::get_registration_health,
            registration::export_test_results,
            registration::clear_test_results,
            registration::get_test_suite_results,
            // Registrar folder commands
            registration::list_registrar_folders,
            registration::create_registrar_folder,
            registration::rename_registrar_folder,
            registration::delete_registrar_folder,
            registration::reorder_registrar_folders,
            registration::reorder_registrars,
            // Notes commands
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::get_note,
            notes::get_notes,
            notes::get_all_notes,
            notes::search_notes,
            notes::get_all_tags,
            notes::get_all_categories,
            // Note folders
            notes::create_note_folder,
            notes::update_note_folder,
            notes::delete_note_folder,
            notes::get_note_folders,
            // Note versions
            notes::create_note_version,
            notes::get_note_versions,
            notes::get_note_version,
            notes::restore_note_version,
            // Note templates
            notes::create_note_template,
            notes::get_note_templates,
            notes::delete_note_template,
            // Advanced search
            notes::search_notes_advanced,
            // Trash / soft-delete
            notes::permanently_delete_note,
            notes::restore_note,
            notes::get_deleted_notes,
            notes::empty_trash,
            // AI features
            notes::get_note_ai_suggestions,
            // Packet capture commands
            packet_capture_commands::list_interfaces,
            packet_capture_commands::get_interface_for_ip,
            packet_capture_commands::start_capture,
            packet_capture_commands::start_capture_pipeline,
            packet_capture_commands::get_pipeline_stats,
            packet_capture_commands::stop_capture,
            packet_capture_commands::get_capture_status,
            packet_capture_commands::get_capture_statistics,
            packet_capture_commands::get_live_statistics,
            packet_capture_commands::get_capture_packets,
            packet_capture_commands::get_capture_packet_count,
            packet_capture_commands::get_capture_packets_range,
            packet_capture_commands::get_filtered_packets,
            packet_capture_commands::get_filtered_packet_count,
            packet_capture_commands::list_capture_sessions,
            packet_capture_commands::get_capture_session,
            packet_capture_commands::export_pcap,
            packet_capture_commands::import_pcap,
            packet_capture_commands::delete_capture_session,
            packet_capture_commands::update_capture_session,
            packet_capture_commands::list_capture_folders,
            packet_capture_commands::create_capture_folder,
            packet_capture_commands::rename_capture_folder,
            packet_capture_commands::delete_capture_folder,
            packet_capture_commands::reorder_capture_folders,
            packet_capture_commands::cleanup_sessions,
            packet_capture_commands::get_session_memory_info,
            // Scheduled captures
            packet_capture_commands::create_scheduled_capture,
            packet_capture_commands::list_scheduled_captures,
            packet_capture_commands::update_scheduled_capture,
            packet_capture_commands::delete_scheduled_capture,
            packet_capture_commands::get_scheduled_captures_due,
            packet_capture_commands::load_capture_session,
            packet_capture_commands::get_rtp_streams,
            packet_capture_commands::get_rtp_stream_history,
            packet_capture_commands::get_all_rtp_stream_histories,
            packet_capture_commands::get_sip_dialogs,
            packet_capture_commands::get_call_sessions,
            packet_capture_commands::diff_call_behavior,
            packet_capture_commands::get_expert_findings,
            packet_capture_commands::get_sip_message_raw,
            packet_capture_commands::get_packet_raw_bytes,
            packet_capture_commands::export_dialog_pcap,
            packet_capture_commands::export_dialog_pcap_base64,
            packet_capture_commands::export_dialog_pcap_save,
            packet_capture_commands::save_export_file,
            packet_capture_commands::generate_call_quality_report,
            packet_capture_commands::create_support_package,
            // Saved filters
            packet_capture_commands::save_filter,
            packet_capture_commands::list_saved_filters,
            packet_capture_commands::delete_saved_filter,
            // Packet bookmarks
            packet_capture_commands::create_packet_bookmark,
            packet_capture_commands::list_packet_bookmarks,
            packet_capture_commands::delete_packet_bookmark,
            // DNS resolution & IP intelligence
            packet_capture_commands::reverse_dns_lookup,
            packet_capture_commands::batch_reverse_dns_lookup,
            packet_capture_commands::ip_lookup,
            // Remote SSH capture
            packet_capture_commands::test_ssh_connection,
            packet_capture_commands::list_remote_interfaces,
            packet_capture_commands::start_remote_capture,
            packet_capture_commands::stop_remote_capture,
            packet_capture_commands::get_active_remote_sessions,
            packet_capture_commands::get_capture_capabilities,
            packet_capture_commands::create_agent_capture_session,
            packet_capture_commands::inject_agent_raw_frames,
            packet_capture_commands::inject_agent_packet_infos,
            packet_capture_commands::stop_agent_capture_session,
            softphone_commands::softphone_place_call,
            softphone_commands::softphone_get_remote_ended_calls,
            softphone_commands::softphone_end_call,
            softphone_commands::softphone_cancel_call,
            softphone_commands::softphone_hold_call,
            softphone_commands::softphone_start_inbound_listener,
            softphone_commands::softphone_stop_inbound_listener,
            softphone_commands::softphone_sync_inbound_listeners,
            softphone_commands::softphone_answer_inbound_call,
            softphone_commands::softphone_reject_inbound_call,
            softphone_commands::softphone_send_dtmf,
            softphone_commands::softphone_send_refer,
            softphone_commands::softphone_send_attended_refer,
            softphone_commands::softphone_start_recording,
            softphone_commands::softphone_stop_recording,
            softphone_commands::softphone_is_recording,
            softphone_commands::softphone_list_recordings,
            softphone_commands::softphone_delete_recording,
            softphone_commands::softphone_read_recording,
            softphone_commands::softphone_subscribe_mwi,
            softphone_commands::softphone_unsubscribe_mwi,
            softphone_commands::softphone_get_mwi_state,
            softphone_commands::set_media_port_range,
            softphone_commands::get_media_port_status,
            softphone_commands::subscribe_blf,
            softphone_commands::unsubscribe_blf,
            softphone_commands::get_blf_state,
            softphone_commands::send_sip_message,
            softphone_commands::publish_presence,
            softphone_commands::unpublish_presence,
            softphone_commands::join_conference,
            softphone_commands::leave_conference,
            softphone_commands::start_options_keepalive,
            softphone_commands::stop_options_keepalive,
            softphone_media_commands::softphone_start_media,
            softphone_media_commands::softphone_stop_media,
            softphone_media_commands::softphone_set_muted,
            softphone_media_commands::softphone_set_audio_devices,
            softphone_media_commands::softphone_set_input_gain,
            softphone_media_commands::softphone_get_call_metrics,
            softphone_media_commands::softphone_get_call_jitter_history,
            softphone_media_commands::softphone_get_call_waveform,
            audio::list_audio_input_devices,
            audio::list_audio_output_devices,
            // Fax Center (SpanDSP-based) — fully independent of softphone
            fax::fax_send,
            fax::fax_send_test_page,
            fax::fax_send_queued,
            fax::fax_send_uploaded,
            fax::fax_send_composed,
            fax::fax_get_audit_log,
            fax::fax_cancel,
            fax::fax_list_prebuilt_docs,
            fax::fax_get_prebuilt_test_doc,
            fax::fax_answer_inbound_call,
            fax::fax_reject_inbound_call,
            // Provision Viewer
            provision::fetch_provision_file,
            provision::fetch_url,
            provision::fetch_image_base64,
            // Contact Import (LDAP)
            contacts_commands::ldap_test_connection,
            contacts_commands::ldap_fetch_contacts,
            // Network Test commands
            network_test_commands::network_health_check,
            network_test_commands::network_get_capabilities,
            network_test_commands::network_ping,
            network_test_commands::network_stop_ping,
            network_test_commands::network_jitter,
            network_test_commands::network_packet_loss,
            network_test_commands::network_bandwidth,
            network_test_commands::network_calculate_mos,
            network_test_commands::network_sip_probe,
            network_test_commands::network_stun_quality,
            network_test_commands::network_traceroute,
            network_test_commands::network_stop_traceroute,
            network_test_commands::network_mtu_discovery,
            network_test_commands::network_dscp_test,
            network_test_commands::network_port_scan,
            network_test_commands::network_get_voip_port_presets,
            network_test_commands::network_expand_port_range,
            network_test_commands::network_dns_lookup,
            network_test_commands::network_stun_test,
            network_test_commands::network_turn_test,
            network_test_commands::network_start_monitor,
            network_test_commands::network_stop_monitor,
            network_test_commands::network_is_monitor_running,
            network_test_commands::network_rtp_simulation,
            network_test_commands::network_speed_test,
            network_test_commands::network_get_interfaces,
            network_test_commands::network_get_wifi_info,
            network_test_commands::network_mtr,
            network_test_commands::network_stop_mtr,
            network_test_commands::network_ntp_check,
            network_test_commands::network_nat_detect,
            network_test_commands::network_snmp_poll,
            // DNS Suite commands
            dns_commands::dns_lookup,
            dns_commands::dns_sip_resolve,
            dns_commands::dns_reverse,
            dns_commands::dns_reverse_batch,
            dns_commands::dns_dig,
            dns_commands::dns_geoip,
            dns_commands::dns_geoip_batch,
            dns_commands::dns_asn_lookup,
            dns_commands::dns_multi_site,
            // SIP Discovery commands (legacy — kept for backward compat)
            sip_discovery_commands::sip_discovery_scan,
            sip_discovery_commands::sip_discovery_stop_scan,
            sip_discovery_commands::sip_discovery_is_running,
            sip_discovery_commands::sip_discovery_expand_targets,
            sip_discovery_commands::sip_discovery_detect_subnet,
            // Network Devices commands (new)
            network_devices_commands::network_devices_scan,
            network_devices_commands::network_devices_stop_scan,
            network_devices_commands::network_devices_is_running,
            network_devices_commands::network_devices_expand_targets,
            network_devices_commands::network_devices_detect_subnet,
            network_devices_commands::network_devices_list_subnets,
            network_devices_commands::network_devices_wake_on_lan,
            network_devices_commands::network_devices_oui_lookup,
            network_devices_commands::network_devices_oui_lookup_batch,
            // Speech recognition commands
            speech_commands::speech_model_status,
            speech_commands::speech_ensure_model,
            speech_commands::speech_start_transcription,
            speech_commands::speech_stop_transcription,
            speech_commands::speech_transcribe_recording,
            // Terminal emulator commands
            terminal_commands::terminal_spawn,
            terminal_commands::terminal_write,
            terminal_commands::terminal_resize,
            terminal_commands::terminal_kill,
            ssh_credentials_commands::set_ssh_connection_password,
            ssh_credentials_commands::get_ssh_connection_password,
            ssh_credentials_commands::delete_ssh_connection_password,
            crafter::crafter_send_sip,
            crafter::crafter_send_http,
            // RTP audio, CDR, live RTP
            packet_capture_commands::rtp_stream_decode_audio,
            packet_capture_commands::rtp_streams_decode_combined,
            packet_capture_commands::rtp_stream_export_wav,
            packet_capture_commands::rtp_stream_analyze_quality,
            packet_capture_commands::export_cdrs,
            packet_capture_commands::get_live_rtp_streams,
            // Remote Agent commands
            remote_agent_commands::remote_agent_start_listener,
            remote_agent_commands::remote_agent_stop_listener,
            remote_agent_commands::remote_agent_is_listener_running,
            remote_agent_commands::remote_agent_list_listeners,
            remote_agent_commands::remote_agent_get_listener_port,
            remote_agent_commands::remote_agent_get_listener_token,
            remote_agent_commands::remote_agent_list_connections,
            remote_agent_commands::remote_agent_send_command,
            remote_agent_commands::remote_agent_rename,
            remote_agent_commands::remote_agent_disconnect,
            remote_agent_commands::remote_agent_kill,
            remote_agent_commands::remote_agent_self_destruct,
            remote_agent_commands::remote_agent_forget,
            remote_agent_commands::remote_agent_generate,
            remote_agent_commands::remote_agent_generate_token,
            remote_agent_commands::remote_agent_connect_relay,
            remote_agent_commands::remote_agent_export_audit_log,
            remote_agent_commands::remote_agent_load_audit_log,
            remote_agent_commands::remote_chat_send,
            remote_agent_commands::remote_chat_get_state,
            remote_agent_commands::remote_chat_mark_read,
            remote_agent_commands::remote_chat_open_window,
            remote_agent_commands::remote_shell_spawn,
            remote_agent_commands::remote_shell_write,
            remote_agent_commands::remote_shell_resize,
            remote_agent_commands::remote_shell_close,
            // Tools commands (local execution)
            tools_commands::tools_list_dir,
            tools_commands::tools_fetch_log,
            tools_commands::tools_syslog_start,
            tools_commands::tools_syslog_stop,
            tools_commands::tools_tail_start,
            tools_commands::tools_tail_stop,
            tools_commands::tools_serve_start,
            tools_commands::tools_serve_stop,
            tools_commands::tools_virtual_serve_start,
            tools_commands::tools_virtual_add_files,
            tools_commands::tools_virtual_remove_file,
            tools_commands::tools_virtual_serve_stop,
            tools_commands::tools_firmware_catalog,
            tools_commands::tools_firmware_check_updates,
            tools_commands::tools_firmware_download,
            tools_commands::tools_firmware_serve,
            tools_commands::tools_firmware_cache_list,
            tools_commands::tools_firmware_cache_clear,
            tools_commands::tools_firmware_get_cache_dir,
            tools_commands::tools_firmware_set_cache_dir,
            tools_commands::tools_firmware_load_prefs,
            // MCP commands
            mcp_commands::mcp_list_profiles,
            mcp_commands::mcp_upsert_profile,
            mcp_commands::mcp_delete_profile,
            mcp_commands::mcp_connect_server,
            mcp_commands::mcp_test_server_connection,
            mcp_commands::mcp_disconnect_server,
            mcp_commands::mcp_list_server_status,
            mcp_commands::mcp_list_tools,
            mcp_commands::mcp_list_resources,
            mcp_commands::mcp_list_prompts,
            mcp_commands::mcp_call_tool,
            mcp_commands::mcp_orchestrate_call,
            mcp_commands::mcp_start_hosted_server,
            mcp_commands::mcp_stop_hosted_server,
            mcp_commands::mcp_get_hosted_server_state,
            // Multicast commands
            multicast_commands::multicast_join_group,
            multicast_commands::multicast_leave_group,
            multicast_commands::multicast_leave_group_exact,
            multicast_commands::multicast_list_groups,
            multicast_commands::multicast_send_test,
            multicast_commands::multicast_igmp_query,
            multicast_commands::multicast_snooping_verify,
            multicast_commands::multicast_stop_listener,
            multicast_commands::multicast_audio_start,
            multicast_commands::multicast_audio_stop,
            multicast_commands::multicast_audio_set_volume,
            multicast_commands::multicast_audio_set_muted,
            multicast_commands::multicast_audio_get_waveform,
            multicast_commands::multicast_audio_get_metrics,
            multicast_commands::multicast_generate_start,
            multicast_commands::multicast_generate_stop,
            multicast_commands::multicast_generate_set_tone,
            multicast_commands::multicast_generate_get_state,
            multicast_commands::multicast_generate_get_metrics,
            multicast_commands::multicast_generate_list,
            multicast_commands::multicast_generate_set_source,
            multicast_commands::multicast_generate_feed_tts,
            multicast_commands::multicast_generate_set_input_gain,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
