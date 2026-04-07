//! T.38 Fax Session using SpanDSP t38_terminal
//!
//! This module provides T.38 fax transmission over UDPTL per ITU-T T.38.
//! It uses SpanDSP's t38_terminal for the T.30 protocol handling.
//!
//! ## ITU-T T.38 Standard Compliance
//! - Version 0 (original T.38) and Version 1 (2002 revision) support
//! - UDPTL transport with redundancy-based error correction
//! - IFP (Internet Fax Protocol) packet handling
//! - Configurable redundancy levels for different packet types
//!
//! ## Safety
//! - Uses Pin<Box<SessionState>> for FFI callback data to prevent moves
//! - Per-session counters (no global statics shared across sessions)
//! - Proper cleanup via Drop implementation
#![cfg_attr(
    not(feature = "spandsp-native"),
    allow(unused_imports, unused_variables, dead_code)
)]

use std::ffi::CString;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::os::raw::{c_int, c_void};
use std::pin::Pin;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::bindings;
use super::session::{FaxSendOptions, T30Error};
use super::udptl::{NativeUdptl, UdptlEcMode};

/// T.38 configuration parameters per ITU-T T.38
#[derive(Debug, Clone)]
pub struct T38Config {
    /// T.38 version (0 = original, 1 = 2002 revision)
    pub version: u8,
    /// Maximum bit rate: 2400-14400 for standard, up to 33600 for V.34
    pub max_bit_rate: u32,
    /// Error correction mode: redundancy or FEC
    pub ec_mode: UdptlEcMode,
    /// Redundancy span for indicators (typically 3)
    pub redundancy_indicator: u8,
    /// Redundancy span for low-speed data (typically 3)
    pub redundancy_low_speed: u8,
    /// Redundancy span for high-speed data (typically 3)
    pub redundancy_high_speed: u8,
    /// Redundancy span for image data (typically 3)
    pub redundancy_image: u8,
    /// Rate management: local TCF (true) or transferred TCF (false)
    pub local_tcf: bool,
    /// Maximum UDPTL packet size
    pub max_datagram: u16,
    /// Enable ECM (Error Correction Mode) per user setting
    pub ecm_enabled: bool,
    /// Modem support flags (from FaxSendOptions)
    pub modem_flags: i32,
    /// Station ID (TSI/CSI)
    pub station_id: String,
    /// Supported bilevel resolution flags (T4_RESOLUTION_* bitmask)
    pub supported_resolutions: i32,
}

impl Default for T38Config {
    fn default() -> Self {
        use super::bindings::resolutions::*;
        Self {
            version: 0,
            max_bit_rate: 14400,
            ec_mode: UdptlEcMode::Redundancy,
            redundancy_indicator: 3,
            redundancy_low_speed: 3,
            redundancy_high_speed: 3,
            redundancy_image: 3,
            local_tcf: true,
            max_datagram: 400,
            ecm_enabled: true,
            modem_flags: 0x07, // V.27ter + V.29 + V.17
            station_id: "SIPalyzer Fax".to_string(),
            supported_resolutions: T4_RESOLUTION_FAX_STANDARD,
        }
    }
}

impl T38Config {
    /// Create from FaxSendOptions
    pub fn from_options(options: &FaxSendOptions) -> Self {
        let modem_flags = options.modem_type.to_spandsp_flags();
        Self {
            max_bit_rate: options.effective_baud_rate(),
            ecm_enabled: options.ecm,
            modem_flags,
            station_id: options
                .station_id
                .clone()
                .unwrap_or_else(|| "SIPalyzer Fax".to_string()),
            supported_resolutions: options.resolution.to_spandsp_flags(),
            ..Default::default()
        }
    }
}

/// T.38 session result
#[derive(Debug, Clone)]
pub struct T38Result {
    pub success: bool,
    pub pages_sent: u32,
    pub error: Option<String>,
    pub t30_error_code: Option<i32>,
    pub remote_station_id: Option<String>,
    pub negotiated_baud_rate: Option<u32>,
    pub ecm_used: Option<bool>,
    pub udptl_packets_sent: u32,
    pub udptl_packets_received: u32,
}

/// Per-session shared state between the T.38 session and callbacks.
/// Pinned to prevent moves while FFI callbacks hold a raw pointer.
struct SessionState {
    /// Packets to be sent (from SpanDSP callback)
    tx_queue: Mutex<Vec<Vec<u8>>>,
    /// Whether the session has completed
    completed: AtomicBool,
    /// Completion code from T.30 phase E
    completion_code: AtomicI32,
    /// Pages transferred (per-session, NOT global)
    pages_transferred: AtomicI32,
    /// UDPTL packets sent (per-session)
    packets_sent: AtomicU32,
    /// UDPTL packets received (per-session)
    packets_received: AtomicU32,
    /// Timer tick count (per-session)
    tick_count: AtomicU32,
    /// TX callback count (per-session)
    tx_callback_count: AtomicU32,
    /// Session ID for log correlation
    session_id: String,
}

/// T.38 terminal session
///
/// Wraps SpanDSP's t38_terminal for T.38 fax over UDPTL.
pub struct T38Session {
    /// Session ID for tracking
    id: String,

    /// SpanDSP t38_terminal state
    #[cfg(feature = "spandsp-native")]
    terminal: *mut bindings::t38_terminal_state_t,

    /// Per-session shared state (Pin<Box<>> to ensure stable address for FFI)
    state: Pin<Box<SessionState>>,

    /// UDPTL encoder/decoder (native SpanDSP implementation — NOT used directly by T38Session;
    /// kept for potential future use. The run_t38_fax_with_config function creates its own.)
    _udptl_ec_mode: UdptlEcMode,

    /// T.38 configuration
    config: T38Config,

    /// Path to TIFF file
    tiff_path: String,

    /// Whether this is calling (sending) or called (receiving)
    is_calling: bool,

    /// Whether the session is active
    active: bool,

    /// Start time
    start_time: Option<Instant>,
}

// Safety: T38Session manages its own memory and the terminal pointer
// is only accessed from the owning thread.
unsafe impl Send for T38Session {}

impl T38Session {
    /// Create a new T.38 session for sending a fax
    #[cfg(feature = "spandsp-native")]
    pub fn new_send(tiff_path: &str, config: Option<T38Config>) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let config = config.unwrap_or_default();

        // Validate file exists
        if !std::path::Path::new(tiff_path).exists() {
            return Err(format!("TIFF file not found: {}", tiff_path));
        }

        let file_size = std::fs::metadata(tiff_path)
            .map_err(|e| format!("TX file not accessible '{}': {}", tiff_path, e))?
            .len();
        if file_size == 0 {
            return Err(format!("TX file is empty: {}", tiff_path));
        }

        // Create pinned session state - address is stable for FFI callbacks
        let state = Box::pin(SessionState {
            tx_queue: Mutex::new(Vec::new()),
            completed: AtomicBool::new(false),
            completion_code: AtomicI32::new(-1),
            pages_transferred: AtomicI32::new(0),
            packets_sent: AtomicU32::new(0),
            packets_received: AtomicU32::new(0),
            tick_count: AtomicU32::new(0),
            tx_callback_count: AtomicU32::new(0),
            session_id: id.clone(),
        });

        // Get raw pointer to the pinned state for FFI callbacks
        let state_ptr = &*state as *const SessionState as *mut c_void;

        unsafe {
            tracing::info!(
                "[T.38:{}] Initializing t38_terminal (calling party)...",
                &id[..8]
            );

            let terminal = bindings::t38_terminal_init(
                ptr::null_mut(),
                1, // calling_party
                Some(tx_packet_handler),
                state_ptr,
            );

            if terminal.is_null() {
                return Err("Failed to initialize T.38 terminal".to_string());
            }

            // Get T.30 state
            let t30 = bindings::t38_terminal_get_t30_state(terminal);
            if t30.is_null() {
                bindings::t38_terminal_free(terminal);
                return Err("Failed to get T.30 state from T.38 terminal".to_string());
            }

            // Set TX file
            let tiff_cstr = CString::new(tiff_path).map_err(|e| e.to_string())?;
            bindings::t30_set_tx_file(t30, tiff_cstr.as_ptr(), -1, -1);

            // Configure T.30 protocol
            let station_cstr = CString::new(config.station_id.as_str()).unwrap_or_default();
            bindings::t30_set_tx_ident(t30, station_cstr.as_ptr());
            bindings::t30_set_supported_modems(t30, config.modem_flags);
            bindings::t30_set_ecm_capability(t30, if config.ecm_enabled { 1 } else { 0 });
            bindings::t30_set_supported_resolutions(t30, config.supported_resolutions);

            // Set phase handlers with per-session state pointer
            bindings::t30_set_phase_b_handler(t30, Some(phase_b_handler), state_ptr);
            bindings::t30_set_phase_d_handler(t30, Some(phase_d_handler), state_ptr);
            bindings::t30_set_phase_e_handler(t30, Some(phase_e_handler), state_ptr);

            // Configure T.38 terminal options
            bindings::t38_terminal_set_tep_mode(terminal, 0);
            bindings::t38_terminal_set_fill_bit_removal(terminal, 1);

            // Configure T.38 core
            let t38_core = bindings::t38_terminal_get_t38_core_state(terminal);
            if !t38_core.is_null() {
                bindings::t38_set_t38_version(t38_core, config.version as c_int);
                bindings::t38_set_data_rate_management_method(
                    t38_core,
                    if config.local_tcf { 2 } else { 1 },
                );
                bindings::t38_set_data_transport_protocol(t38_core, 0); // UDPTL
                bindings::t38_set_max_datagram_size(t38_core, config.max_datagram as c_int);
                bindings::t38_set_tep_handling(t38_core, 0);

                // Set redundancy per category
                bindings::t38_set_redundancy_control(
                    t38_core,
                    0,
                    config.redundancy_indicator as c_int,
                );
                bindings::t38_set_redundancy_control(
                    t38_core,
                    1,
                    config.redundancy_low_speed as c_int,
                );
                bindings::t38_set_redundancy_control(
                    t38_core,
                    2,
                    config.redundancy_high_speed as c_int,
                );
                bindings::t38_set_redundancy_control(t38_core, 3, config.redundancy_image as c_int);
            }

            tracing::info!(
                "[T.38:{}] Initialized: file={} ({}B), modems=0x{:02x}, ecm={}, version={}",
                &id[..8],
                tiff_path,
                file_size,
                config.modem_flags,
                config.ecm_enabled,
                config.version
            );

            Ok(Self {
                id,
                terminal,
                state,
                _udptl_ec_mode: config.ec_mode,
                config,
                tiff_path: tiff_path.to_string(),
                is_calling: true,
                active: false,
                start_time: None,
            })
        }
    }

    /// Create a new T.38 session for receiving a fax
    #[cfg(feature = "spandsp-native")]
    pub fn new_receive(output_tiff_path: &str, config: Option<T38Config>) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let config = config.unwrap_or_default();

        let state = Box::pin(SessionState {
            tx_queue: Mutex::new(Vec::new()),
            completed: AtomicBool::new(false),
            completion_code: AtomicI32::new(-1),
            pages_transferred: AtomicI32::new(0),
            packets_sent: AtomicU32::new(0),
            packets_received: AtomicU32::new(0),
            tick_count: AtomicU32::new(0),
            tx_callback_count: AtomicU32::new(0),
            session_id: id.clone(),
        });

        let state_ptr = &*state as *const SessionState as *mut c_void;

        unsafe {
            let terminal = bindings::t38_terminal_init(
                ptr::null_mut(),
                0, // called_party
                Some(tx_packet_handler),
                state_ptr,
            );

            if terminal.is_null() {
                return Err("Failed to initialize T.38 terminal for receive".to_string());
            }

            let t30 = bindings::t38_terminal_get_t30_state(terminal);
            if t30.is_null() {
                bindings::t38_terminal_free(terminal);
                return Err("Failed to get T.30 state".to_string());
            }

            let tiff_cstr = CString::new(output_tiff_path).map_err(|e| e.to_string())?;
            bindings::t30_set_rx_file(t30, tiff_cstr.as_ptr(), -1);

            let station_cstr = CString::new(config.station_id.as_str()).unwrap_or_default();
            bindings::t30_set_tx_ident(t30, station_cstr.as_ptr());
            bindings::t30_set_supported_modems(t30, config.modem_flags);
            bindings::t30_set_ecm_capability(t30, if config.ecm_enabled { 1 } else { 0 });
            bindings::t30_set_supported_resolutions(t30, config.supported_resolutions);

            bindings::t30_set_phase_b_handler(t30, Some(phase_b_handler), state_ptr);
            bindings::t30_set_phase_d_handler(t30, Some(phase_d_handler), state_ptr);
            bindings::t30_set_phase_e_handler(t30, Some(phase_e_handler), state_ptr);

            let t38_core = bindings::t38_terminal_get_t38_core_state(terminal);
            if !t38_core.is_null() {
                bindings::t38_set_t38_version(t38_core, config.version as c_int);
                bindings::t38_set_redundancy_control(
                    t38_core,
                    0,
                    config.redundancy_indicator as c_int,
                );
                bindings::t38_set_redundancy_control(
                    t38_core,
                    1,
                    config.redundancy_low_speed as c_int,
                );
                bindings::t38_set_redundancy_control(
                    t38_core,
                    2,
                    config.redundancy_high_speed as c_int,
                );
                bindings::t38_set_redundancy_control(t38_core, 3, config.redundancy_image as c_int);
            }

            tracing::info!("[T.38:{}] Initialized receive session", &id[..8]);

            Ok(Self {
                id,
                terminal,
                state,
                _udptl_ec_mode: config.ec_mode,
                config,
                tiff_path: output_tiff_path.to_string(),
                is_calling: false,
                active: false,
                start_time: None,
            })
        }
    }

    /// Check if the session has completed
    pub fn is_completed(&self) -> bool {
        self.state.completed.load(Ordering::SeqCst)
    }

    /// Get pending TX packets (IFP packets from SpanDSP)
    pub fn get_tx_packets(&mut self) -> Vec<Vec<u8>> {
        if let Ok(mut queue) = self.state.tx_queue.lock() {
            std::mem::take(&mut *queue)
        } else {
            Vec::new()
        }
    }

    /// Process a received IFP packet
    #[cfg(feature = "spandsp-native")]
    pub fn process_rx_packet(&mut self, ifp_packet: &[u8], seq: u16) -> Result<(), String> {
        if !self.active {
            return Err("Session not active".to_string());
        }

        unsafe {
            let t38_core = bindings::t38_terminal_get_t38_core_state(self.terminal);
            if t38_core.is_null() {
                return Err("No T.38 core state".to_string());
            }

            let result = bindings::t38_core_rx_ifp_packet(
                t38_core,
                ifp_packet.as_ptr(),
                ifp_packet.len() as c_int,
                seq,
            );

            if result != 0 {
                tracing::error!(
                    "[T.38:{}] rx_ifp_packet error {} for seq={} len={}",
                    &self.id[..8],
                    result,
                    seq,
                    ifp_packet.len()
                );
            }
        }

        Ok(())
    }

    /// Run the T.38 timer (call every 20ms = 160 samples at 8kHz)
    #[cfg(feature = "spandsp-native")]
    pub fn timer_tick(&mut self) -> Result<(), String> {
        if !self.active {
            return Err("Session not active".to_string());
        }

        let tick = self.state.tick_count.fetch_add(1, Ordering::Relaxed);

        unsafe {
            let result = bindings::t38_terminal_send_timeout(self.terminal, 160);

            if tick < 5 || (result != 0 && tick >= 5) {
                tracing::info!("[T.38:{}] tick #{}: result={}", &self.id[..8], tick, result);
            }
        }

        Ok(())
    }

    /// Start the session
    #[cfg(feature = "spandsp-native")]
    pub fn start(&mut self) -> Result<(), String> {
        if self.active {
            return Err("Session already active".to_string());
        }

        unsafe {
            let result =
                bindings::t38_terminal_restart(self.terminal, if self.is_calling { 1 } else { 0 });
            if result != 0 {
                tracing::warn!(
                    "[T.38:{}] Warning: t38_terminal_restart returned {}",
                    &self.id[..8],
                    result
                );
            }
        }

        self.active = true;
        self.start_time = Some(Instant::now());
        tracing::info!(
            "[T.38:{}] Session started (calling={})",
            &self.id[..8],
            self.is_calling
        );
        Ok(())
    }

    /// Get session ID
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Get UDPTL packets sent count
    pub fn packets_sent(&self) -> u32 {
        self.state.packets_sent.load(Ordering::SeqCst)
    }

    /// Get UDPTL packets received count
    pub fn packets_received(&self) -> u32 {
        self.state.packets_received.load(Ordering::SeqCst)
    }

    /// Increment packets sent counter
    pub fn record_packet_sent(&self) {
        self.state.packets_sent.fetch_add(1, Ordering::SeqCst);
    }

    /// Increment packets received counter
    pub fn record_packet_received(&self) {
        self.state.packets_received.fetch_add(1, Ordering::SeqCst);
    }

    /// Stop the session and get results
    #[cfg(feature = "spandsp-native")]
    pub fn stop(&mut self) -> T38Result {
        self.active = false;

        let completion_code = self.state.completion_code.load(Ordering::SeqCst);
        let success = completion_code == 0;
        let t30_error = T30Error::from_code(completion_code);
        let pages = self.state.pages_transferred.load(Ordering::SeqCst) as u32;

        let (remote_id, baud_rate, ecm_used) = unsafe {
            let t30 = bindings::t38_terminal_get_t30_state(self.terminal);
            if !t30.is_null() {
                let ident = bindings::t30_get_rx_ident(t30);
                let remote_id = if !ident.is_null() {
                    std::ffi::CStr::from_ptr(ident)
                        .to_str()
                        .ok()
                        .map(|s| s.to_string())
                } else {
                    None
                };

                let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
                bindings::t30_get_transfer_statistics(t30, &mut stats);

                (
                    remote_id,
                    Some(stats.bit_rate as u32),
                    Some(stats.error_correcting_mode != 0),
                )
            } else {
                (None, None, None)
            }
        };

        let pkts_sent = self.packets_sent();
        let pkts_recv = self.packets_received();

        tracing::error!(
            "[T.38:{}] Stopped: success={}, pages={}, code={} ({}), tx={}, rx={}",
            &self.id[..8],
            success,
            pages,
            completion_code,
            t30_error.description(),
            pkts_sent,
            pkts_recv
        );

        T38Result {
            success,
            pages_sent: pages,
            error: if success {
                None
            } else {
                Some(t30_error.description().to_string())
            },
            t30_error_code: Some(completion_code),
            remote_station_id: remote_id,
            negotiated_baud_rate: baud_rate,
            ecm_used,
            udptl_packets_sent: pkts_sent,
            udptl_packets_received: pkts_recv,
        }
    }
}

impl Drop for T38Session {
    fn drop(&mut self) {
        #[cfg(feature = "spandsp-native")]
        unsafe {
            if !self.terminal.is_null() {
                bindings::t38_terminal_free(self.terminal);
            }
        }
    }
}

// ====== FFI Callbacks (use raw pointer to pinned SessionState) ======

/// TX packet handler callback from SpanDSP.
/// Safety: state_ptr points to a Pin<Box<SessionState>> that outlives the terminal.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn tx_packet_handler(
    _s: *mut bindings::t38_core_state_t,
    user_data: *mut c_void,
    buf: *const u8,
    len: c_int,
    _count: c_int,
) -> c_int {
    if user_data.is_null() || buf.is_null() || len <= 0 {
        return -1;
    }

    let state = &*(user_data as *const SessionState);
    let cb_num = state.tx_callback_count.fetch_add(1, Ordering::Relaxed);

    if cb_num < 5 {
        tracing::info!(
            "[T.38:{}] tx_packet #{}: len={}",
            &state.session_id[..8],
            cb_num,
            len
        );
    }

    let packet = std::slice::from_raw_parts(buf, len as usize).to_vec();
    if let Ok(mut queue) = state.tx_queue.lock() {
        queue.push(packet);
    }

    0
}

/// Phase B handler - called after DIS/DCS negotiation.
/// MUST return 0 to tell SpanDSP to proceed. Non-zero = abort session.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_b_handler(
    s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    result: c_int,
) -> c_int {
    if user_data.is_null() {
        return 0;
    }
    let state = &*(user_data as *const SessionState);

    if !s.is_null() {
        let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
        bindings::t30_get_transfer_statistics(s, &mut stats);
        tracing::error!(
            "[T.38:{}] Phase B: result={}, rate={}, ecm={}",
            &state.session_id[..8],
            result,
            stats.bit_rate,
            stats.error_correcting_mode
        );

        let rx_ident = bindings::t30_get_rx_ident(s);
        if !rx_ident.is_null() {
            if let Ok(id) = std::ffi::CStr::from_ptr(rx_ident).to_str() {
                if !id.is_empty() {
                    tracing::info!("[T.38:{}] Remote station: {}", &state.session_id[..8], id);
                }
            }
        }
    }

    0 // Always return 0 to proceed with fax transmission
}

/// Phase D handler - called after each page transfer.
/// MUST return 0 to tell SpanDSP to continue. Non-zero = abort session.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_d_handler(
    _s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    result: c_int,
) -> c_int {
    if user_data.is_null() {
        return 0;
    }
    let state = &*(user_data as *const SessionState);
    let pages = state.pages_transferred.fetch_add(1, Ordering::SeqCst) + 1;
    tracing::info!(
        "[T.38:{}] Phase D: page {} (result={})",
        &state.session_id[..8],
        pages,
        result
    );
    0 // Always return 0 to continue to next page
}

/// Phase E handler - called when T.30 session completes
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_e_handler(
    s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    completion_code: c_int,
) {
    if user_data.is_null() {
        return;
    }
    let state = &*(user_data as *const SessionState);
    state
        .completion_code
        .store(completion_code, Ordering::SeqCst);
    state.completed.store(true, Ordering::SeqCst);

    let t30_error = T30Error::from_code(completion_code);
    tracing::error!(
        "[T.38:{}] Phase E: code={} ({})",
        &state.session_id[..8],
        completion_code,
        t30_error.description()
    );

    if !s.is_null() {
        let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
        bindings::t30_get_transfer_statistics(s, &mut stats);
        tracing::error!(
            "[T.38:{}] Final stats: pages_tx={}, pages_rx={}, rate={}, ecm={}",
            &state.session_id[..8],
            stats.pages_tx,
            stats.pages_rx,
            stats.bit_rate,
            stats.error_correcting_mode
        );
    }
}

/// Progress callback for T.38 transmission — called periodically with (tx_packets, rx_packets, elapsed_secs)
pub type T38ProgressCallback = Box<dyn Fn(u32, u32, u64) + Send>;

/// Run a T.38 fax transmission over UDPTL
#[cfg(feature = "spandsp-native")]
pub fn run_t38_fax(
    tiff_path: &str,
    local_udptl_port: u16,
    remote_addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
) -> Result<T38Result, String> {
    run_t38_fax_with_config(
        tiff_path,
        local_udptl_port,
        remote_addr,
        shutdown,
        None,
        None,
        None,
    )
}

/// Run a T.38 fax transmission over UDPTL with progress callback
#[cfg(feature = "spandsp-native")]
pub fn run_t38_fax_with_progress(
    tiff_path: &str,
    local_udptl_port: u16,
    remote_addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
    on_progress: T38ProgressCallback,
) -> Result<T38Result, String> {
    run_t38_fax_with_config(
        tiff_path,
        local_udptl_port,
        remote_addr,
        shutdown,
        None,
        Some(on_progress),
        None,
    )
}

/// Run a T.38 fax transmission over UDPTL with custom configuration
#[cfg(feature = "spandsp-native")]
pub fn run_t38_fax_with_config(
    tiff_path: &str,
    local_udptl_port: u16,
    remote_addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
    config: Option<T38Config>,
    on_progress: Option<T38ProgressCallback>,
    existing_socket: Option<UdpSocket>,
) -> Result<T38Result, String> {
    let config = config.unwrap_or_default();

    tracing::info!(
        "Starting transmission to {} (local port {})",
        remote_addr,
        local_udptl_port
    );
    tracing::info!(
        "Config: version={}, max_rate={}, ecm={}, ec={:?}",
        config.version,
        config.max_bit_rate,
        config.ecm_enabled,
        config.ec_mode
    );

    let mut session = T38Session::new_send(tiff_path, Some(config.clone()))?;
    session.start()?;

    // Use pre-bound UDPTL socket if provided (for STUN probing), otherwise bind fresh
    let socket = if let Some(sock) = existing_socket {
        tracing::info!("Using pre-bound UDPTL socket (port {})", local_udptl_port);
        sock
    } else {
        UdpSocket::bind(format!("0.0.0.0:{}", local_udptl_port))
            .map_err(|e| format!("Failed to bind UDPTL port {}: {}", local_udptl_port, e))?
    };
    // Use short (1ms) read timeout for non-blocking-like behavior.
    // Timing is driven by Instant-based 20ms pacing, NOT socket timeout.
    // Previous bug: 20ms socket timeout + 5ms sleep = 25ms per tick, but timer_tick(160)
    // tells SpanDSP only 20ms passed → T.30 timers drifted 20% slow.
    let _ = socket.set_nonblocking(false);
    socket
        .set_read_timeout(Some(Duration::from_millis(1)))
        .map_err(|e| format!("Failed to set socket timeout: {}", e))?;
    socket
        .set_write_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| format!("Failed to set send timeout: {}", e))?;

    let start_time = Instant::now();
    let max_duration = Duration::from_secs(180); // 3 min max — multi-page ECM faxes can take 2+ min
    let mut rx_buffer = vec![0u8; 1500];
    // Native SpanDSP UDPTL encoder and decoder — the same implementation used
    // by FreeSWITCH, Asterisk, and other production virtual fax stacks.
    let mut udptl_encoder = NativeUdptl::new(config.ec_mode, config.redundancy_image as usize)
        .map_err(|e| format!("Failed to init UDPTL encoder: {}", e))?;
    let mut udptl_decoder = NativeUdptl::new(UdptlEcMode::Redundancy, 3)
        .map_err(|e| format!("Failed to init UDPTL decoder: {}", e))?;

    // Strict 20ms frame pacing via Instant (matches G.711 loop design)
    let frame_interval = Duration::from_millis(20);
    let mut next_tick_time = Instant::now();

    // Track last RX separately — TX alone doesn't prove the remote side is alive.
    // SpanDSP keeps generating TX (CNG, retransmits) even when the remote is silent,
    // so tracking TX resets the inactivity timer and hides a dead connection.
    // Declared early so the hole-punch block can update it if we receive a packet.
    let mut last_rx_time = Instant::now();

    // ──────────────────────────────────────────────────────────────────────
    // NAT hole-punch: Mirror the aggressive approach that works for RTP.
    //
    // In T.38, the calling party (us) normally waits silently for the called
    // party to send DIS first.  But if we're behind NAT, the remote's UDPTL
    // packets are blocked because no outgoing packet from our port has created
    // a NAT pinhole yet.
    //
    // The RTP path's reliable approach: send multiple packets, also STUN-ping
    // known servers (broadens NAT mapping), then wait up to 3s for any return.
    // We replicate that here because the SBC's UDPTL gateway often needs
    // 1-2 seconds to set up after the re-INVITE 200 OK.
    // ──────────────────────────────────────────────────────────────────────
    {
        // UDPTL keepalive: valid UDPTL-like packet (seq=0, empty IFP, no error recovery)
        let keepalive: &[u8] = &[0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

        // Phase 1: Send initial burst of hole-punch packets to the SBC UDPTL port
        for i in 0..5 {
            if let Err(e) = socket.send_to(keepalive, remote_addr) {
                tracing::error!("NAT hole-punch #{} failed: {}", i, e);
            }
        }

        // Also send STUN pings from this socket to broaden the NAT mapping
        // (same technique as fax_media's STUN probes).
        let stun_request: [u8; 20] = [
            0x00, 0x01, // Binding Request
            0x00, 0x00, // Length: 0
            0x21, 0x12, 0xA4, 0x42, // Magic cookie
            // Transaction ID (12 bytes)
            0xFA, 0xCE, 0x00, 0x38, 0xFA, 0xCE, 0x00, 0x38, 0xFA, 0xCE, 0x00, 0x38,
        ];
        for stun_addr in &["stun.l.google.com:19302", "stun.cloudflare.com:3478"] {
            if let Ok(addrs) = stun_addr.to_socket_addrs() {
                for addr in addrs.take(1) {
                    let _ = socket.send_to(&stun_request, addr);
                }
            }
        }

        tracing::info!("Sent 5 hole-punch packets to {} + STUN pings", remote_addr);

        // Phase 2: Wait up to 3 seconds for any return packet, sending keepalives
        // every 200ms to keep the NAT mapping alive and give the SBC time to set up.
        let punch_start = Instant::now();
        let punch_timeout = Duration::from_secs(3);
        let mut got_rx = false;
        let mut probe_buf = [0u8; 64];
        // Use short timeout for probing
        let _ = socket.set_read_timeout(Some(Duration::from_millis(100)));
        while punch_start.elapsed() < punch_timeout {
            match socket.recv_from(&mut probe_buf) {
                Ok((len, from)) => {
                    tracing::info!(
                        "Got RX from {} ({} bytes) after {:.1}s — bidirectional!",
                        from,
                        len,
                        punch_start.elapsed().as_secs_f64()
                    );
                    got_rx = true;
                    last_rx_time = Instant::now();
                    break;
                }
                Err(_) => {
                    // Timeout — send another keepalive and try again
                    let _ = socket.send_to(keepalive, remote_addr);
                }
            }
        }
        if !got_rx {
            tracing::info!("No return packet during hole-punch (3s) — proceeding anyway");
        }

        // Restore the 1ms read timeout for the main loop
        let _ = socket.set_read_timeout(Some(Duration::from_millis(1)));
    }

    // RX inactivity timeouts:
    // - During idle/negotiation: 30s is reasonable (remote should respond quickly)
    // - During active TX (Phase C image data): the RECEIVER stays SILENT while we
    //   transmit pages. For a 2-page ECM fax at 14400 bps, Phase C can take 60-90s.
    //   We must NOT abort during this normal silence.
    let rx_idle_timeout = Duration::from_secs(30); // No TX, no RX → remote is dead
    let rx_active_timeout = Duration::from_secs(90); // Active TX, no RX → Phase C silence
    let mut last_progress_report = Instant::now();
    let progress_interval = Duration::from_secs(2);
    let mut last_keepalive = Instant::now();
    let keepalive_interval = Duration::from_secs(5); // Keep NAT mapping alive
    let mut last_tx_time = Instant::now(); // Track when we last sent data

    while !shutdown.load(Ordering::Relaxed) && !session.is_completed() {
        if start_time.elapsed() > max_duration {
            tracing::warn!("Timeout after {} seconds", max_duration.as_secs());
            break;
        }

        // Dynamic RX timeout: if we're actively transmitting (Phase C), the remote
        // is expected to be silent. Use a longer timeout. If we're idle (pre-Phase B
        // or waiting for response after EOP), use a shorter timeout.
        let recently_transmitting = last_tx_time.elapsed() < Duration::from_secs(5);
        let effective_rx_timeout = if recently_transmitting {
            rx_active_timeout
        } else {
            rx_idle_timeout
        };
        if last_rx_time.elapsed() > effective_rx_timeout {
            tracing::info!(
                "No packets received for {:.0}s (tx_active={}) — remote unresponsive, aborting",
                last_rx_time.elapsed().as_secs_f64(),
                recently_transmitting
            );
            break;
        }

        let now = Instant::now();

        // Strict 20ms pacing: only tick when the next frame time arrives.
        // This ensures t38_terminal_send_timeout(160) = exactly 20ms of simulated time,
        // matching wall-clock time so T.30 timers fire at the correct intervals.
        if now >= next_tick_time {
            next_tick_time = now + frame_interval;

            // Drive the T.38 state machine (160 samples = 20ms at 8kHz)
            session.timer_tick()?;

            // Send queued TX packets (IFP → UDPTL via SpanDSP native encoder)
            let tx_packets = session.get_tx_packets();
            let had_tx = !tx_packets.is_empty();
            for ifp_packet in tx_packets {
                if let Some(udptl_packet) = udptl_encoder.encode(&ifp_packet) {
                    session.record_packet_sent();
                    if let Err(e) = socket.send_to(&udptl_packet, remote_addr) {
                        tracing::error!("Send error: {}", e);
                    }
                }
            }
            if had_tx {
                last_tx_time = Instant::now();
            }

            // NAT keepalive: if SpanDSP hasn't generated any TX (calling party waits
            // for DIS), send periodic keepalive to keep the NAT pinhole open.
            if !had_tx && last_keepalive.elapsed() >= keepalive_interval {
                last_keepalive = Instant::now();
                let keepalive: &[u8] = &[0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
                let _ = socket.send_to(keepalive, remote_addr);
            }

            // Emit periodic progress
            if last_progress_report.elapsed() >= progress_interval {
                last_progress_report = Instant::now();
                if let Some(ref cb) = on_progress {
                    cb(
                        session.packets_sent(),
                        session.packets_received(),
                        start_time.elapsed().as_secs(),
                    );
                }
            }
        }

        // Receive UDPTL packets — non-blocking poll. Accept from any source
        // (SBC/media proxy may relay from a different IP than the SDP answer).
        loop {
            match socket.recv_from(&mut rx_buffer) {
                Ok((len, from)) => {
                    let pkts_so_far = session.packets_received();
                    if pkts_so_far < 3 {
                        tracing::info!(
                            "RX #{}: {} bytes from {} (expected {})",
                            pkts_so_far,
                            len,
                            from,
                            remote_addr
                        );
                    }
                    last_rx_time = Instant::now();
                    session.record_packet_received();

                    // Decode UDPTL → IFP via SpanDSP native decoder.
                    // This handles redundancy recovery, FEC, and sequence tracking.
                    let decoded_ifps = udptl_decoder.decode(&rx_buffer[..len]);
                    if decoded_ifps.is_empty() && len > 0 && pkts_so_far < 5 {
                        tracing::info!(
                            "UDPTL decode returned 0 IFPs, len={}, first_bytes={:02x?}",
                            len,
                            &rx_buffer[..len.min(16)]
                        );
                    }
                    for (seq, ifp_packet) in decoded_ifps {
                        if let Err(e) = session.process_rx_packet(&ifp_packet, seq) {
                            tracing::error!("RX process error seq={}: {}", seq, e);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => {
                    tracing::error!("Receive error: {}", e);
                    break;
                }
            }
        }

        // Sleep until next tick (avoid busy-wait)
        let now = Instant::now();
        if now < next_tick_time {
            let sleep_dur = next_tick_time - now;
            if sleep_dur > Duration::from_millis(1) {
                std::thread::sleep(sleep_dur - Duration::from_millis(1));
            }
        }
    }

    // Report cancelled if shutdown was signalled — explicitly terminate the T.30 session
    // so SpanDSP can send DCN (disconnect) to the remote and release resources cleanly.
    if shutdown.load(Ordering::Relaxed) {
        tracing::info!("Cancelled by user — terminating T.30 session");
        // Give SpanDSP a chance to send DCN by running a few more timer ticks
        for _ in 0..5 {
            let _ = session.timer_tick();
            let tx_packets = session.get_tx_packets();
            for ifp_packet in tx_packets {
                if let Some(udptl_packet) = udptl_encoder.encode(&ifp_packet) {
                    let _ = socket.send_to(&udptl_packet, remote_addr);
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    let result = session.stop();
    tracing::info!(
        "Complete: success={}, pages={}, tx={}, rx={}",
        result.success,
        result.pages_sent,
        result.udptl_packets_sent,
        result.udptl_packets_received
    );

    Ok(result)
}

/// Run a T.38 fax receive session over UDPTL.
///
/// Similar to the send loop but uses `T38Session::new_receive()`.
/// The SpanDSP T.30 state machine handles the called-party (answering) protocol internally.
#[cfg(feature = "spandsp-native")]
pub fn run_t38_fax_receive(
    output_tiff_path: &str,
    local_udptl_port: u16,
    remote_addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
    config: Option<T38Config>,
    on_progress: Option<T38ProgressCallback>,
) -> Result<T38Result, String> {
    let config = config.unwrap_or_default();

    tracing::info!(
        "Starting receive from {} (local port {})",
        remote_addr,
        local_udptl_port
    );
    tracing::info!(
        "Config: version={}, ecm={}, ec={:?}",
        config.version,
        config.ecm_enabled,
        config.ec_mode
    );

    let mut session = T38Session::new_receive(output_tiff_path, Some(config.clone()))?;
    session.start()?;

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", local_udptl_port))
        .map_err(|e| format!("Failed to bind UDPTL port {}: {}", local_udptl_port, e))?;
    let _ = socket.set_nonblocking(false);
    socket
        .set_read_timeout(Some(Duration::from_millis(1)))
        .map_err(|e| format!("Failed to set socket timeout: {}", e))?;
    socket
        .set_write_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| format!("Failed to set send timeout: {}", e))?;

    let start_time = Instant::now();
    let max_duration = Duration::from_secs(180); // Receive may be longer (multi-page)
    let mut rx_buffer = vec![0u8; 1500];

    let mut udptl_encoder = NativeUdptl::new(config.ec_mode, config.redundancy_image as usize)
        .map_err(|e| format!("Failed to init UDPTL encoder: {}", e))?;
    let mut udptl_decoder = NativeUdptl::new(UdptlEcMode::Redundancy, 3)
        .map_err(|e| format!("Failed to init UDPTL decoder: {}", e))?;

    let frame_interval = Duration::from_millis(20);
    let mut next_tick_time = Instant::now();

    // NAT hole-punch (important — we're answering, so the caller is likely waiting for our DIS)
    {
        let keepalive: &[u8] = &[0x00, 0x00, 0x00, 0x00];
        for i in 0..3 {
            if let Err(e) = socket.send_to(keepalive, remote_addr) {
                tracing::error!("NAT keepalive #{} failed: {}", i, e);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        tracing::info!("Sent 3 NAT hole-punch packets to {}", remote_addr);
    }

    let mut last_rx_time = Instant::now();
    let rx_inactivity_timeout = Duration::from_secs(45); // Slightly longer for receive
    let mut last_progress_report = Instant::now();
    let progress_interval = Duration::from_secs(2);
    let mut last_keepalive = Instant::now();
    let keepalive_interval = Duration::from_secs(5);

    while !shutdown.load(Ordering::Relaxed) && !session.is_completed() {
        if start_time.elapsed() > max_duration {
            tracing::warn!("Timeout after {} seconds", max_duration.as_secs());
            break;
        }

        if last_rx_time.elapsed() > rx_inactivity_timeout {
            tracing::warn!(
                "No packets received for {}s — remote gone, aborting",
                rx_inactivity_timeout.as_secs()
            );
            break;
        }

        let now = Instant::now();

        if now >= next_tick_time {
            next_tick_time = now + frame_interval;

            // Drive T.38 state machine (20ms tick)
            session.timer_tick()?;

            // Send TX packets (DIS, CFR, MCF — our responses to the caller)
            let tx_packets = session.get_tx_packets();
            let had_tx = !tx_packets.is_empty();
            for ifp_packet in tx_packets {
                if let Some(udptl_packet) = udptl_encoder.encode(&ifp_packet) {
                    session.record_packet_sent();
                    if let Err(e) = socket.send_to(&udptl_packet, remote_addr) {
                        tracing::error!("Send error: {}", e);
                    }
                }
            }

            // Keepalive
            if !had_tx && last_keepalive.elapsed() >= keepalive_interval {
                last_keepalive = Instant::now();
                let keepalive: &[u8] = &[0x00, 0x00, 0x00, 0x00];
                let _ = socket.send_to(keepalive, remote_addr);
            }

            // Progress
            if last_progress_report.elapsed() >= progress_interval {
                last_progress_report = Instant::now();
                if let Some(ref cb) = on_progress {
                    cb(
                        session.packets_sent(),
                        session.packets_received(),
                        start_time.elapsed().as_secs(),
                    );
                }
            }
        }

        // Receive UDPTL (non-blocking poll)
        loop {
            match socket.recv_from(&mut rx_buffer) {
                Ok((len, from)) => {
                    let pkts_so_far = session.packets_received();
                    if pkts_so_far < 3 {
                        tracing::info!("RX #{}: {} bytes from {}", pkts_so_far, len, from);
                    }
                    last_rx_time = Instant::now();
                    session.record_packet_received();

                    let decoded_ifps = udptl_decoder.decode(&rx_buffer[..len]);
                    for (seq, ifp_packet) in decoded_ifps {
                        if let Err(e) = session.process_rx_packet(&ifp_packet, seq) {
                            tracing::error!("RX process error seq={}: {}", seq, e);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => {
                    tracing::error!("Receive error: {}", e);
                    break;
                }
            }
        }

        // Sleep until next tick
        let now = Instant::now();
        if now < next_tick_time {
            let sleep_dur = next_tick_time - now;
            if sleep_dur > Duration::from_millis(1) {
                std::thread::sleep(sleep_dur - Duration::from_millis(1));
            }
        }
    }

    if shutdown.load(Ordering::Relaxed) {
        tracing::info!("Cancelled");
    }

    let result = session.stop();
    tracing::info!(
        "Complete: success={}, pages={}, tx={}, rx={}",
        result.success,
        result.pages_sent,
        result.udptl_packets_sent,
        result.udptl_packets_received
    );

    Ok(result)
}

#[cfg(not(feature = "spandsp-native"))]
pub fn run_t38_fax_receive(
    _output_tiff_path: &str,
    _local_udptl_port: u16,
    _remote_addr: SocketAddr,
    _shutdown: Arc<AtomicBool>,
    _config: Option<T38Config>,
    _on_progress: Option<T38ProgressCallback>,
) -> Result<T38Result, String> {
    Err("SpanDSP not available".to_string())
}

// ====== Stub implementations when SpanDSP is not available ======

#[cfg(not(feature = "spandsp-native"))]
impl T38Session {
    pub fn new_send(_tiff_path: &str, _config: Option<T38Config>) -> Result<Self, String> {
        Err("SpanDSP not available. Install with: brew install spandsp".to_string())
    }

    pub fn new_receive(
        _output_tiff_path: &str,
        _config: Option<T38Config>,
    ) -> Result<Self, String> {
        Err("SpanDSP not available".to_string())
    }

    pub fn start(&mut self) -> Result<(), String> {
        Err("SpanDSP not available".to_string())
    }

    pub fn stop(&mut self) -> T38Result {
        T38Result {
            success: false,
            pages_sent: 0,
            error: Some("SpanDSP not available".to_string()),
            t30_error_code: None,
            remote_station_id: None,
            negotiated_baud_rate: None,
            ecm_used: None,
            udptl_packets_sent: 0,
            udptl_packets_received: 0,
        }
    }
}

#[cfg(not(feature = "spandsp-native"))]
pub fn run_t38_fax(
    _tiff_path: &str,
    _local_udptl_port: u16,
    _remote_addr: SocketAddr,
    _shutdown: Arc<AtomicBool>,
) -> Result<T38Result, String> {
    Err("SpanDSP not available".to_string())
}

#[cfg(not(feature = "spandsp-native"))]
pub fn run_t38_fax_with_progress(
    _tiff_path: &str,
    _local_udptl_port: u16,
    _remote_addr: SocketAddr,
    _shutdown: Arc<AtomicBool>,
    _on_progress: T38ProgressCallback,
) -> Result<T38Result, String> {
    Err("SpanDSP not available".to_string())
}

#[cfg(not(feature = "spandsp-native"))]
pub fn run_t38_fax_with_config(
    _tiff_path: &str,
    _local_udptl_port: u16,
    _remote_addr: SocketAddr,
    _shutdown: Arc<AtomicBool>,
    _config: Option<T38Config>,
    _on_progress: Option<T38ProgressCallback>,
    _existing_socket: Option<UdpSocket>,
) -> Result<T38Result, String> {
    Err("SpanDSP not available".to_string())
}
