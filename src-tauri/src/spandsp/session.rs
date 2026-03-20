//! SpanDSP Fax Session Management
//!
//! This module provides a safe Rust wrapper around SpanDSP's fax functionality.
//! It handles the lifecycle of fax sessions and provides methods for audio I/O.
//!
//! ## Industry Standards Implemented:
//! - ITU-T T.30: Group 3 fax protocol
//! - ITU-T T.38: Real-time virtual faxing
//! - ITU-T V.17: 14400/12000/9600/7200 bps modulation
//! - ITU-T V.29: 9600/7200 bps modulation  
//! - ITU-T V.27ter: 4800/2400 bps modulation
//! - G.711 µ-law (PCMU) and A-law (PCMA) codec support
#![cfg_attr(not(feature = "spandsp-native"), allow(unused_imports, unused_variables, dead_code))]

use serde::{Deserialize, Serialize};
use std::ffi::CString;
use std::os::raw::{c_int, c_void};
use std::pin::Pin;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

use super::bindings;

/// Fax transmission mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FaxMode {
    /// T.38 over UDPTL (preferred for VoIP) - ITU-T T.38
    #[serde(alias = "T38Udptl", alias = "t38")]
    T38Udptl,
    /// G.711 µ-law audio passthrough (SpanDSP handles modulation)
    #[serde(alias = "AudioPassthrough", alias = "g711", alias = "g711u")]
    AudioPassthrough,
}

impl Default for FaxMode {
    fn default() -> Self {
        FaxMode::T38Udptl
    }
}

/// Supported modem types for fax transmission
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModemType {
    /// V.27ter only (2400/4800 bps) - most compatible
    V27ter,
    /// V.27ter + V.29 (up to 9600 bps)
    V29,
    /// V.27ter + V.29 + V.17 (up to 14400 bps) - standard
    V17,
    /// All modems including V.34 (up to 33600 bps) - Super G3
    V34,
}

impl Default for ModemType {
    fn default() -> Self {
        ModemType::V17 // Standard fax modulation
    }
}

impl ModemType {
    /// Convert to SpanDSP modem support flags
    pub fn to_spandsp_flags(&self) -> i32 {
        use super::bindings::modems::*;
        match self {
            ModemType::V27ter => T30_SUPPORT_V27TER,
            ModemType::V29 => T30_SUPPORT_V27TER | T30_SUPPORT_V29,
            ModemType::V17 => T30_SUPPORT_STANDARD, // V27ter + V29 + V17
            ModemType::V34 => T30_SUPPORT_STANDARD | T30_SUPPORT_V34,
        }
    }
    
    /// Get maximum baud rate for this modem type
    pub fn max_baud_rate(&self) -> u32 {
        match self {
            ModemType::V27ter => 4800,
            ModemType::V29 => 9600,
            ModemType::V17 => 14400,
            ModemType::V34 => 33600,
        }
    }
}

/// G.711 codec variant
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum G711Variant {
    /// µ-law (PCMU) - North America, Japan
    #[default]
    #[serde(alias = "PCMU", alias = "ulaw", alias = "mulaw")]
    MuLaw,
    /// A-law (PCMA) - Europe, rest of world
    #[serde(alias = "PCMA", alias = "alaw")]
    ALaw,
}

/// Fax resolution setting — determines TIFF DPI and T.30 negotiated resolution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FaxResolutionOption {
    /// Standard: 204×98 DPI
    Standard,
    /// Fine: 204×196 DPI (default — best for text)
    Fine,
}

impl Default for FaxResolutionOption {
    fn default() -> Self { Self::Fine }
}

impl FaxResolutionOption {
    /// Convert to SpanDSP T4_RESOLUTION bitmask.
    /// We always include standard as a fallback so the remote can downgrade if needed.
    pub fn to_spandsp_flags(self) -> i32 {
        use super::bindings::resolutions::*;
        match self {
            Self::Standard => T4_RESOLUTION_R8_STANDARD,
            Self::Fine => T4_RESOLUTION_R8_STANDARD | T4_RESOLUTION_R8_FINE,
        }
    }

    /// Convert to tiff module resolution for TIFF generation
    pub fn to_tiff_resolution(self) -> super::tiff::FaxResolution {
        match self {
            Self::Standard => super::tiff::FaxResolution::Standard,
            Self::Fine => super::tiff::FaxResolution::Fine,
        }
    }
}

/// Options for sending a fax
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaxSendOptions {
    /// Transmission mode (T.38 or G.711 passthrough)
    #[serde(default)]
    pub mode: FaxMode,
    
    /// Enable Error Correction Mode (ECM) - ITU-T T.30 Annex A
    /// ECM provides automatic error detection and retransmission
    #[serde(default = "default_ecm")]
    pub ecm: bool,
    
    /// Maximum baud rate: 2400, 4800, 7200, 9600, 12000, 14400, 33600
    /// Will be capped to modem_type maximum if higher
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    
    /// Modem type selection (V.27ter, V.29, V.17, V.34)
    #[serde(default)]
    pub modem_type: ModemType,
    
    /// G.711 codec variant for audio passthrough mode
    #[serde(default)]
    pub g711_variant: G711Variant,
    
    /// Transmitting Station Identifier (TSI) - up to 20 characters per T.30
    pub station_id: Option<String>,
    
    /// Header info to print on each page (timestamp + this text)
    pub header_info: Option<String>,
    
    /// Number of retries on transmission failure (T.30 protocol level)
    #[serde(default = "default_retries")]
    pub retries: u32,
    
    /// Timeout in seconds for the entire fax transmission
    #[serde(default = "default_timeout")]
    pub timeout_secs: u32,
    
    /// Force T.38 without fallback to G.711 (fail if T.38 rejected)
    #[serde(default)]
    pub force_t38: bool,
    
    /// Force G.711 passthrough without attempting T.38
    #[serde(default)]
    pub force_g711: bool,

    /// Image resolution: "standard" (204×98) or "fine" (204×196)
    #[serde(default)]
    pub resolution: FaxResolutionOption,
}

fn default_ecm() -> bool { true }
fn default_baud_rate() -> u32 { 14400 }
fn default_retries() -> u32 { 2 }
fn default_timeout() -> u32 { 300 } // 5 minutes

impl Default for FaxSendOptions {
    fn default() -> Self {
        Self {
            mode: FaxMode::default(),
            ecm: true,
            baud_rate: 14400,
            modem_type: ModemType::default(),
            g711_variant: G711Variant::default(),
            station_id: None,
            header_info: None,
            retries: default_retries(),
            timeout_secs: default_timeout(),
            force_t38: false,
            force_g711: false,
            resolution: FaxResolutionOption::default(),
        }
    }
}

impl FaxSendOptions {
    /// Create options for T.38 mode with ECM enabled (recommended)
    pub fn t38_with_ecm() -> Self {
        Self {
            mode: FaxMode::T38Udptl,
            ecm: true,
            ..Default::default()
        }
    }
    
    /// Create options for G.711 µ-law passthrough mode
    pub fn g711_mulaw() -> Self {
        Self {
            mode: FaxMode::AudioPassthrough,
            g711_variant: G711Variant::MuLaw,
            force_g711: true,
            ..Default::default()
        }
    }
    
    /// Create options for maximum compatibility (lower baud, V.27ter only)
    pub fn max_compatibility() -> Self {
        Self {
            mode: FaxMode::T38Udptl,
            ecm: false,
            baud_rate: 4800,
            modem_type: ModemType::V27ter,
            ..Default::default()
        }
    }
    
    /// Get the effective baud rate (capped to modem type max)
    pub fn effective_baud_rate(&self) -> u32 {
        self.baud_rate.min(self.modem_type.max_baud_rate())
    }
    
    /// Validate and fix options
    pub fn validate(&mut self) {
        // Cap baud rate to modem type maximum
        self.baud_rate = self.effective_baud_rate();
        
        // Truncate station ID to 20 characters per T.30
        if let Some(ref mut sid) = self.station_id {
            if sid.len() > 20 {
                *sid = sid.chars().take(20).collect();
            }
        }
        
        // Can't force both T.38 and G.711
        if self.force_t38 && self.force_g711 {
            self.force_g711 = false;
        }
        
        // If forcing G.711, set mode accordingly
        if self.force_g711 {
            self.mode = FaxMode::AudioPassthrough;
        }
    }
}

/// T.30 error codes with human-readable descriptions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum T30Error {
    Ok = 0,
    CedTone = 1,
    T0Expired = 2,
    T1Expired = 3,
    T3Expired = 4,
    HdlcCarrierLost = 5,
    CannotTrain = 6,
    OperatorIntFail = 7,
    Incompatible = 8,
    RxIncapable = 9,
    TxIncapable = 10,
    NoResSupport = 11,
    NoSizeSupport = 12,
    Unexpected = 13,
    TxBadDcs = 14,
    TxBadPage = 15,
    TxEcmPhd = 16,
    TxGotDcn = 17,
    TxInvalRsp = 18,
    TxNoDis = 19,
    TxPhbDead = 20,
    TxPhdDead = 21,
    TxT5Exp = 22,
    RxEcmPhd = 23,
    RxGotDcs = 24,
    RxInvalCmd = 25,
    RxNoCarrier = 26,
    RxNoEol = 27,
    RxNoFax = 28,
    RxT2ExpDcn = 29,
    RxT2ExpD = 30,
    RxT2ExpFax = 31,
    RxT2ExpMps = 32,
    RxT2ExpRr = 33,
    RxT2Exp = 34,
    RxDcnWhy = 35,
    RxDcnData = 36,
    RxDcnFax = 37,
    RxDcnPhd = 38,
    RxDcnRrd = 39,
    RxDcnNoRtn = 40,
    FileError = 41,
    NoPage = 42,
    BadTiff = 43,
    BadPage = 44,
    BadTag = 45,
    BadTiffHdr = 46,
    NoMem = 47,
    Unknown = 99,
}

impl T30Error {
    pub fn from_code(code: i32) -> Self {
        match code {
            0 => T30Error::Ok,
            1 => T30Error::CedTone,
            2 => T30Error::T0Expired,
            3 => T30Error::T1Expired,
            4 => T30Error::T3Expired,
            5 => T30Error::HdlcCarrierLost,
            6 => T30Error::CannotTrain,
            7 => T30Error::OperatorIntFail,
            8 => T30Error::Incompatible,
            9 => T30Error::RxIncapable,
            10 => T30Error::TxIncapable,
            11 => T30Error::NoResSupport,
            12 => T30Error::NoSizeSupport,
            13 => T30Error::Unexpected,
            14 => T30Error::TxBadDcs,
            15 => T30Error::TxBadPage,
            16 => T30Error::TxEcmPhd,
            17 => T30Error::TxGotDcn,
            18 => T30Error::TxInvalRsp,
            19 => T30Error::TxNoDis,
            20 => T30Error::TxPhbDead,
            21 => T30Error::TxPhdDead,
            22 => T30Error::TxT5Exp,
            23 => T30Error::RxEcmPhd,
            24 => T30Error::RxGotDcs,
            25 => T30Error::RxInvalCmd,
            26 => T30Error::RxNoCarrier,
            27 => T30Error::RxNoEol,
            28 => T30Error::RxNoFax,
            29 => T30Error::RxT2ExpDcn,
            30 => T30Error::RxT2ExpD,
            31 => T30Error::RxT2ExpFax,
            32 => T30Error::RxT2ExpMps,
            33 => T30Error::RxT2ExpRr,
            34 => T30Error::RxT2Exp,
            35 => T30Error::RxDcnWhy,
            36 => T30Error::RxDcnData,
            37 => T30Error::RxDcnFax,
            38 => T30Error::RxDcnPhd,
            39 => T30Error::RxDcnRrd,
            40 => T30Error::RxDcnNoRtn,
            41 => T30Error::FileError,
            42 => T30Error::NoPage,
            43 => T30Error::BadTiff,
            44 => T30Error::BadPage,
            45 => T30Error::BadTag,
            46 => T30Error::BadTiffHdr,
            47 => T30Error::NoMem,
            _ => T30Error::Unknown,
        }
    }
    
    pub fn description(&self) -> &'static str {
        match self {
            T30Error::Ok => "Success",
            T30Error::CedTone => "CED tone not detected - no fax machine answered",
            T30Error::T0Expired => "T0 timer expired - no initial response",
            T30Error::T1Expired => "T1 timer expired - remote did not respond",
            T30Error::T3Expired => "T3 timer expired - no response to commands",
            T30Error::HdlcCarrierLost => "HDLC carrier lost - line quality issue",
            T30Error::CannotTrain => "Cannot train modems - incompatible or noisy line",
            T30Error::OperatorIntFail => "Operator intervention failed",
            T30Error::Incompatible => "Incompatible destination capabilities",
            T30Error::RxIncapable => "Receiver not capable",
            T30Error::TxIncapable => "Transmitter not capable",
            T30Error::NoResSupport => "Resolution not supported by remote",
            T30Error::NoSizeSupport => "Page size not supported by remote",
            T30Error::Unexpected => "Unexpected T.30 message received - protocol mismatch",
            T30Error::TxBadDcs => "Bad DCS received during transmit",
            T30Error::TxBadPage => "Bad page during transmit",
            T30Error::TxEcmPhd => "ECM phase D error during transmit",
            T30Error::TxGotDcn => "Received DCN (disconnect) during transmit",
            T30Error::TxInvalRsp => "Invalid response during transmit",
            T30Error::TxNoDis => "No DIS received - remote may not be a fax",
            T30Error::TxPhbDead => "Phase B dead during transmit",
            T30Error::TxPhdDead => "Phase D dead during transmit",
            T30Error::TxT5Exp => "T5 timer expired during transmit",
            T30Error::RxEcmPhd => "ECM phase D error during receive",
            T30Error::RxGotDcs => "Got DCS during receive",
            T30Error::RxInvalCmd => "Invalid command during receive",
            T30Error::RxNoCarrier => "No carrier during receive",
            T30Error::RxNoEol => "No end-of-line marker during receive",
            T30Error::RxNoFax => "No fax detected during receive",
            T30Error::RxT2ExpDcn => "T2 expired with DCN during receive",
            T30Error::RxT2ExpD => "T2 expired with D during receive",
            T30Error::RxT2ExpFax => "T2 expired with fax during receive",
            T30Error::RxT2ExpMps => "T2 expired with MPS during receive",
            T30Error::RxT2ExpRr => "T2 expired with RR during receive",
            T30Error::RxT2Exp => "T2 expired during receive",
            T30Error::RxDcnWhy => "Received DCN unexpectedly",
            T30Error::RxDcnData => "DCN received during data",
            T30Error::RxDcnFax => "DCN received during fax",
            T30Error::RxDcnPhd => "DCN received during phase D",
            T30Error::RxDcnRrd => "DCN received during RRD",
            T30Error::RxDcnNoRtn => "DCN received - no return path",
            T30Error::FileError => "File error - check TIFF file",
            T30Error::NoPage => "No page to send - TIFF file may be empty",
            T30Error::BadTiff => "Bad TIFF file - invalid format",
            T30Error::BadPage => "Bad page in TIFF file",
            T30Error::BadTag => "Bad TIFF tag",
            T30Error::BadTiffHdr => "Bad TIFF header",
            T30Error::NoMem => "Out of memory",
            T30Error::Unknown => "Unknown error occurred",
        }
    }
}

/// Result of a fax transmission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaxResult {
    /// Whether the fax was sent successfully
    pub success: bool,
    
    /// Number of pages sent
    pub pages_sent: u32,
    
    /// Total duration in milliseconds
    pub duration_ms: u64,
    
    /// Error message if failed
    pub error: Option<String>,
    
    /// T.30 error code (for detailed diagnostics)
    pub t30_error_code: Option<i32>,
    
    /// T.30 error description
    pub t30_error_description: Option<String>,
    
    /// Remote station ID (CSI) received from the remote fax
    pub remote_station_id: Option<String>,
    
    /// Negotiated baud rate used
    pub negotiated_baud_rate: Option<u32>,
    
    /// Whether ECM was used
    pub ecm_used: Option<bool>,
    
    /// Transport used: "T.38" or "G.711"
    pub transport: Option<String>,
    
    /// Image resolution used (e.g., "204x98", "204x196")
    pub resolution: Option<String>,
    
    /// Total bytes transmitted
    pub bytes_transmitted: Option<u64>,
    
    /// Number of retransmissions (ECM only)
    pub ecm_retransmissions: Option<u32>,
}

impl FaxResult {
    /// Create a successful result
    pub fn success(pages_sent: u32, duration_ms: u64) -> Self {
        Self {
            success: true,
            pages_sent,
            duration_ms,
            error: None,
            t30_error_code: Some(0),
            t30_error_description: Some("Success".to_string()),
            remote_station_id: None,
            negotiated_baud_rate: None,
            ecm_used: None,
            transport: None,
            resolution: None,
            bytes_transmitted: None,
            ecm_retransmissions: None,
        }
    }
    
    /// Create a failed result
    pub fn failure(error: impl Into<String>, duration_ms: u64) -> Self {
        Self {
            success: false,
            pages_sent: 0,
            duration_ms,
            error: Some(error.into()),
            t30_error_code: None,
            t30_error_description: None,
            remote_station_id: None,
            negotiated_baud_rate: None,
            ecm_used: None,
            transport: None,
            resolution: None,
            bytes_transmitted: None,
            ecm_retransmissions: None,
        }
    }
    
    /// Create a failed result with T.30 error code
    pub fn failure_with_code(t30_code: i32, duration_ms: u64) -> Self {
        let t30_error = T30Error::from_code(t30_code);
        Self {
            success: false,
            pages_sent: 0,
            duration_ms,
            error: Some(t30_error.description().to_string()),
            t30_error_code: Some(t30_code),
            t30_error_description: Some(t30_error.description().to_string()),
            remote_station_id: None,
            negotiated_baud_rate: None,
            ecm_used: None,
            transport: None,
            resolution: None,
            bytes_transmitted: None,
            ecm_retransmissions: None,
        }
    }
}

/// Per-session shared state for FFI callbacks.
/// Pinned to ensure stable address for raw pointers passed to SpanDSP.
struct PhaseEState {
    completed: AtomicBool,
    completion_code: AtomicI32,
    pages_transferred: AtomicI32,
    session_id: String,
}

/// SpanDSP fax session
/// 
/// This wraps SpanDSP's fax_state_t for safe use from Rust.
/// For G.711 mode, it manages the modulation/demodulation of fax signals.
/// 
/// ## Usage
/// ```ignore
/// let options = FaxSendOptions::default();
/// let mut session = FaxSession::new_send("document.tiff", &options)?;
/// session.start()?;
/// 
/// // Feed audio samples in a loop
/// while !session.is_completed() {
///     let samples = session.get_audio(&mut buffer)?;
///     // ... send via RTP
/// }
/// 
/// let result = session.stop();
/// ```
#[allow(dead_code)]
pub struct FaxSession {
    /// Session ID for tracking
    id: String,
    
    /// Whether this is a calling (sending) or called (receiving) party
    is_calling: bool,
    
    /// Current mode
    mode: FaxMode,
    
    /// Options used for this session
    options: FaxSendOptions,
    
    /// Path to TIFF file
    tiff_path: String,
    
    /// Whether the session is active
    active: bool,
    
    /// SpanDSP fax state (only valid when spandsp-native is enabled)
    #[cfg(feature = "spandsp-native")]
    fax_state: *mut bindings::fax_state_t,
    
    /// Per-session state for FFI callbacks (Pin<Box<>> for address stability)
    phase_e_state: Pin<Box<PhaseEState>>,
    
    /// Station ID (kept alive for SpanDSP)
    station_id: Option<CString>,
    
    /// Header info (kept alive for SpanDSP)
    header_info: Option<CString>,
    
    /// Start time for duration tracking
    start_time: Option<std::time::Instant>,
}

// Safety: FaxSession manages its own memory and synchronization
unsafe impl Send for FaxSession {}

impl FaxSession {
    /// Create a new fax session for sending
    pub fn new_send(tiff_path: &str, options: &FaxSendOptions) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();
        
        // Validate TIFF file exists
        if !std::path::Path::new(tiff_path).exists() {
            return Err(format!("TIFF file not found: {}", tiff_path));
        }
        
        // Validate options
        let mut opts = options.clone();
        opts.validate();
        
        let phase_e_state = Box::pin(PhaseEState {
            completed: AtomicBool::new(false),
            completion_code: AtomicI32::new(-1),
            pages_transferred: AtomicI32::new(0),
            session_id: id.clone(),
        });
        
        let station_id = opts.station_id.as_ref()
            .and_then(|s| CString::new(s.as_str()).ok());
        
        let header_info = opts.header_info.as_ref()
            .and_then(|s| CString::new(s.as_str()).ok());
        
        // Get raw pointer to pinned state for FFI callbacks
        #[cfg(feature = "spandsp-native")]
        let state_ptr = &*phase_e_state as *const PhaseEState as *mut c_void;
        
        #[cfg(feature = "spandsp-native")]
        let fax_state = unsafe {
            let state = bindings::fax_init(ptr::null_mut(), 1);
            if state.is_null() {
                return Err("Failed to initialize SpanDSP fax state".to_string());
            }
            
            let t30 = bindings::fax_get_t30_state(state);
            if t30.is_null() {
                bindings::fax_free(state);
                return Err("Failed to get T.30 state".to_string());
            }
            
            // Station ID (TSI)
            if let Some(ref sid) = station_id {
                bindings::t30_set_tx_ident(t30, sid.as_ptr());
            } else {
                let default_id = CString::new("SIPalyzer Fax").unwrap();
                bindings::t30_set_tx_ident(t30, default_id.as_ptr());
            }
            
            // Modem type from user options
            let modem_flags = opts.modem_type.to_spandsp_flags();
            bindings::t30_set_supported_modems(t30, modem_flags);
            
            // ECM from user options
            bindings::t30_set_ecm_capability(t30, if opts.ecm { 1 } else { 0 });
            
            // Resolution support (driven by user setting)
            bindings::t30_set_supported_resolutions(t30, opts.resolution.to_spandsp_flags());
            
            // TX file
            let tiff_cstr = CString::new(tiff_path).map_err(|e| e.to_string())?;
            bindings::t30_set_tx_file(t30, tiff_cstr.as_ptr(), -1, -1);
            
            // Phase handlers using pinned state pointer (no Arc::into_raw)
            bindings::t30_set_phase_b_handler(t30, Some(phase_b_callback), state_ptr);
            bindings::t30_set_phase_d_handler(t30, Some(phase_d_callback), state_ptr);
            bindings::t30_set_phase_e_handler(t30, Some(phase_e_callback), state_ptr);
            
            bindings::fax_set_transmit_on_idle(state, 1);
            
            tracing::info!("[SpanDSP:{}] Init: modem={:?} (0x{:02x}), ecm={}, baud={}",
                     &id[..8], opts.modem_type, modem_flags, opts.ecm, opts.effective_baud_rate());
            
            state
        };
        
        Ok(Self {
            id,
            is_calling: true,
            mode: opts.mode,
            options: opts,
            tiff_path: tiff_path.to_string(),
            active: false,
            #[cfg(feature = "spandsp-native")]
            fax_state,
            phase_e_state,
            station_id,
            header_info,
            start_time: None,
        })
    }
    
    /// Get the options used for this session
    pub fn options(&self) -> &FaxSendOptions {
        &self.options
    }
    
    /// Create a new fax session for receiving
    #[allow(dead_code)]
    pub fn new_receive(output_tiff_path: &str, options: &FaxSendOptions) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();
        
        let mut opts = options.clone();
        opts.validate();
        
        let phase_e_state = Box::pin(PhaseEState {
            completed: AtomicBool::new(false),
            completion_code: AtomicI32::new(-1),
            pages_transferred: AtomicI32::new(0),
            session_id: id.clone(),
        });
        
        let station_id = opts.station_id.as_ref()
            .and_then(|s| CString::new(s.as_str()).ok());
        
        #[cfg(feature = "spandsp-native")]
        let state_ptr = &*phase_e_state as *const PhaseEState as *mut c_void;
        
        #[cfg(feature = "spandsp-native")]
        let fax_state = unsafe {
            let state = bindings::fax_init(ptr::null_mut(), 0);
            if state.is_null() {
                return Err("Failed to initialize SpanDSP fax state".to_string());
            }
            
            let t30 = bindings::fax_get_t30_state(state);
            if t30.is_null() {
                bindings::fax_free(state);
                return Err("Failed to get T.30 state".to_string());
            }
            
            // Configure receive T.30 properly
            let tiff_cstr = CString::new(output_tiff_path).map_err(|e| e.to_string())?;
            bindings::t30_set_rx_file(t30, tiff_cstr.as_ptr(), -1);
            
            if let Some(ref sid) = station_id {
                bindings::t30_set_tx_ident(t30, sid.as_ptr());
            }
            
            let modem_flags = opts.modem_type.to_spandsp_flags();
            bindings::t30_set_supported_modems(t30, modem_flags);
            bindings::t30_set_ecm_capability(t30, if opts.ecm { 1 } else { 0 });
            bindings::t30_set_supported_resolutions(t30, opts.resolution.to_spandsp_flags());
            
            bindings::t30_set_phase_b_handler(t30, Some(phase_b_callback), state_ptr);
            bindings::t30_set_phase_d_handler(t30, Some(phase_d_callback), state_ptr);
            bindings::t30_set_phase_e_handler(t30, Some(phase_e_callback), state_ptr);
            
            tracing::info!("[SpanDSP:{}] Init receive: modem=0x{:02x}, ecm={}", &id[..8], modem_flags, opts.ecm);
            
            state
        };
        
        Ok(Self {
            id,
            is_calling: false,
            mode: FaxMode::AudioPassthrough,
            options: opts,
            tiff_path: output_tiff_path.to_string(),
            active: false,
            #[cfg(feature = "spandsp-native")]
            fax_state,
            phase_e_state,
            station_id,
            header_info: None,
            start_time: None,
        })
    }
    
    /// Get the session ID
    #[allow(dead_code)]
    pub fn id(&self) -> &str {
        &self.id
    }
    
    /// Get the current mode
    #[allow(dead_code)]
    pub fn mode(&self) -> FaxMode {
        self.mode
    }
    
    /// Check if the session is active
    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.active
    }
    
    /// Check if the fax session has completed (phase E reached)
    pub fn is_completed(&self) -> bool {
        self.phase_e_state.completed.load(Ordering::SeqCst)
    }
    
    /// Get the completion code (T30_ERR_* value)
    pub fn completion_code(&self) -> i32 {
        self.phase_e_state.completion_code.load(Ordering::SeqCst)
    }
    
    /// Start the fax session
    pub fn start(&mut self) -> Result<(), String> {
        if self.active {
            return Err("Session already active".to_string());
        }
        
        #[cfg(not(feature = "spandsp-native"))]
        {
            return Err("SpanDSP native support not available. Install SpanDSP: brew install spandsp".to_string());
        }
        
        #[cfg(feature = "spandsp-native")]
        {
            if self.fax_state.is_null() {
                return Err("Fax state not initialized".to_string());
            }
            self.active = true;
            self.start_time = Some(std::time::Instant::now());
            tracing::info!("Session {} started", self.id);
            Ok(())
        }
    }
    
    /// Get elapsed time since session started
    pub fn elapsed_ms(&self) -> u64 {
        self.start_time
            .map(|t| t.elapsed().as_millis() as u64)
            .unwrap_or(0)
    }
    
    /// Get audio samples to transmit (for G.711 mode)
    /// 
    /// Returns the number of samples written to the buffer.
    /// For sending, these samples should be encoded as G.711 and sent via RTP.
    pub fn get_audio(&mut self, samples: &mut [i16]) -> Result<usize, String> {
        if !self.active {
            return Err("Session not active".to_string());
        }
        
        #[cfg(not(feature = "spandsp-native"))]
        {
            // Return silence
            samples.fill(0);
            return Ok(samples.len());
        }
        
        #[cfg(feature = "spandsp-native")]
        unsafe {
            let count = bindings::fax_tx(
                self.fax_state,
                samples.as_mut_ptr(),
                samples.len() as c_int,
            );
            
            if count < 0 {
                return Err("fax_tx failed".to_string());
            }
            
            Ok(count as usize)
        }
    }
    
    /// Process received audio samples (for G.711 mode)
    /// 
    /// For receiving, decode the G.711 RTP payload and pass the PCM samples here.
    pub fn process_audio(&mut self, samples: &[i16]) -> Result<(), String> {
        if !self.active {
            return Err("Session not active".to_string());
        }
        
        #[cfg(not(feature = "spandsp-native"))]
        {
            let _ = samples;
            return Ok(());
        }
        
        #[cfg(feature = "spandsp-native")]
        unsafe {
            // Note: fax_rx takes a const pointer but bindgen generated it as *mut
            // This is safe because SpanDSP doesn't modify the input buffer
            let result = bindings::fax_rx(
                self.fax_state,
                samples.as_ptr() as *mut i16,
                samples.len() as c_int,
            );
            
            if result < 0 {
                return Err("fax_rx failed".to_string());
            }
            
            Ok(())
        }
    }
    
    /// Fill in missing audio samples (for packet loss)
    pub fn fill_audio(&mut self, num_samples: usize) -> Result<(), String> {
        if !self.active {
            return Err("Session not active".to_string());
        }
        
        #[cfg(not(feature = "spandsp-native"))]
        {
            let _ = num_samples;
            return Ok(());
        }
        
        #[cfg(feature = "spandsp-native")]
        unsafe {
            bindings::fax_rx_fillin(self.fax_state, num_samples as c_int);
            Ok(())
        }
    }
    
    /// Get transfer statistics
    #[cfg(feature = "spandsp-native")]
    pub fn get_statistics(&self) -> Option<bindings::t30_stats_t> {
        if self.fax_state.is_null() {
            return None;
        }
        
        unsafe {
            let t30 = bindings::fax_get_t30_state(self.fax_state);
            if t30.is_null() {
                return None;
            }
            
            let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
            bindings::t30_get_transfer_statistics(t30, &mut stats);
            Some(stats)
        }
    }
    
    /// Get the remote station ID (after fax completion)
    #[cfg(feature = "spandsp-native")]
    pub fn get_remote_station_id(&self) -> Option<String> {
        if self.fax_state.is_null() {
            return None;
        }
        
        unsafe {
            let t30 = bindings::fax_get_t30_state(self.fax_state);
            if t30.is_null() {
                return None;
            }
            
            let ident = bindings::t30_get_rx_ident(t30);
            if ident.is_null() {
                return None;
            }
            
            std::ffi::CStr::from_ptr(ident)
                .to_str()
                .ok()
                .map(|s| s.to_string())
        }
    }
    
    /// Stop the fax session and get the result
    pub fn stop(&mut self) -> FaxResult {
        let duration_ms = self.elapsed_ms();
        
        if !self.active {
            return FaxResult::failure("Session was not active", duration_ms);
        }
        
        self.active = false;
        
        #[cfg(not(feature = "spandsp-native"))]
        {
            return FaxResult::failure("SpanDSP not available", duration_ms);
        }
        
        #[cfg(feature = "spandsp-native")]
        unsafe {
            if self.fax_state.is_null() {
                return FaxResult::failure("No fax state", duration_ms);
            }
            
            // Terminate the T.30 session if not already completed
            let t30 = bindings::fax_get_t30_state(self.fax_state);
            if !t30.is_null() && !self.is_completed() {
                bindings::t30_terminate(t30);
            }
            
            let completion_code = self.completion_code();
            let success = completion_code == bindings::T30_ERR_OK as i32;
            let t30_error = T30Error::from_code(completion_code);
            
            // Get statistics
            let stats = self.get_statistics();
            let pages_sent = stats.as_ref().map(|s| s.pages_tx as u32).unwrap_or(0);
            let pages_received = stats.as_ref().map(|s| s.pages_rx as u32).unwrap_or(0);
            let total_pages = if self.is_calling { pages_sent } else { pages_received };
            let baud_rate = stats.as_ref().map(|s| s.bit_rate as u32);
            let ecm_used = stats.as_ref().map(|s| s.error_correcting_mode != 0);
            let image_size = stats.as_ref().map(|s| s.image_size as u64);
            let resolution = stats.as_ref().map(|s| {
                format!("{}x{}", s.x_resolution, s.y_resolution)
            });
            
            let remote_id = self.get_remote_station_id();
            
            let transport = match self.mode {
                FaxMode::T38Udptl => "T.38",
                FaxMode::AudioPassthrough => match self.options.g711_variant {
                    G711Variant::MuLaw => "G.711 µ-law",
                    G711Variant::ALaw => "G.711 A-law",
                },
            };
            
            tracing::error!("Session {} stopped: success={}, pages={}, code={} ({})", transport, success, total_pages, completion_code, t30_error.description());
            
            FaxResult {
                success,
                pages_sent: total_pages,
                duration_ms,
                error: if success { None } else { Some(t30_error.description().to_string()) },
                t30_error_code: Some(completion_code),
                t30_error_description: Some(t30_error.description().to_string()),
                remote_station_id: remote_id,
                negotiated_baud_rate: baud_rate,
                ecm_used,
                transport: Some(transport.to_string()),
                resolution,
                bytes_transmitted: image_size,
                ecm_retransmissions: None, // Would need ECM-specific stats
            }
        }
    }
    
    /// Get number of pages transferred so far
    pub fn pages_transferred(&self) -> i32 {
        self.phase_e_state.pages_transferred.load(Ordering::SeqCst)
    }
}

impl Drop for FaxSession {
    fn drop(&mut self) {
        if self.active {
            let _ = self.stop();
        }
        
        #[cfg(feature = "spandsp-native")]
        unsafe {
            if !self.fax_state.is_null() {
                bindings::fax_free(self.fax_state);
                self.fax_state = ptr::null_mut();
            }
        }
    }
}

/// Phase B callback - called during T.30 negotiation (DIS/DCS exchange).
/// MUST return 0 to tell SpanDSP to proceed. Non-zero = abort session.
/// Safety: user_data points to a Pin<Box<PhaseEState>> owned by FaxSession.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_b_callback(
    s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    result: c_int,
) -> c_int {
    if user_data.is_null() || s.is_null() {
        return 0;
    }
    
    let state = &*(user_data as *const PhaseEState);
    
    let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
    bindings::t30_get_transfer_statistics(s, &mut stats);
    tracing::error!("[SpanDSP:{}] Phase B: result={}, rate={}, ecm={}",
             &state.session_id[..8], result, stats.bit_rate, stats.error_correcting_mode);
    
    0 // Always return 0 to proceed with fax transmission
}

/// Phase D callback - called after each page transfer.
/// MUST return 0 to tell SpanDSP to continue. Non-zero = abort session.
/// Safety: user_data points to a Pin<Box<PhaseEState>> owned by FaxSession.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_d_callback(
    _s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    result: c_int,
) -> c_int {
    if user_data.is_null() {
        return 0;
    }
    
    let state = &*(user_data as *const PhaseEState);
    let pages = state.pages_transferred.fetch_add(1, Ordering::SeqCst) + 1;
    tracing::info!("[SpanDSP:{}] Phase D: page {} (result={})", &state.session_id[..8], pages, result);
    
    0 // Always return 0 to continue to next page
}

/// Phase E callback - called when T.30 session completes.
/// Safety: user_data points to a Pin<Box<PhaseEState>> owned by FaxSession.
#[cfg(feature = "spandsp-native")]
unsafe extern "C" fn phase_e_callback(
    s: *mut bindings::t30_state_t,
    user_data: *mut c_void,
    completion_code: c_int,
) {
    if user_data.is_null() {
        return;
    }
    
    let state = &*(user_data as *const PhaseEState);
    state.completion_code.store(completion_code, Ordering::SeqCst);
    state.completed.store(true, Ordering::SeqCst);
    
    let t30_error = T30Error::from_code(completion_code);
    tracing::error!("[SpanDSP:{}] Phase E: code={} ({})", &state.session_id[..8], completion_code, t30_error.description());
    
    if !s.is_null() {
        let mut stats = std::mem::zeroed::<bindings::t30_stats_t>();
        bindings::t30_get_transfer_statistics(s, &mut stats);
        tracing::error!("[SpanDSP:{}] Final: pages_tx={}, pages_rx={}, rate={}, ecm={}",
                 &state.session_id[..8], stats.pages_tx, stats.pages_rx, stats.bit_rate, stats.error_correcting_mode);
    }
}

// Note: Additional T.30 configuration functions (set_supported_modems, set_ecm_capability,
// set_tx_page_header_info, set_rx_ident) are available in the generated SpanDSP bindings
// but may not be present in all SpanDSP versions. When using native SpanDSP, these
// functions are called directly via the bindings if available.

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_fax_send_options_default() {
        let opts = FaxSendOptions::default();
        assert!(opts.ecm);
        assert_eq!(opts.baud_rate, 14400);
        assert_eq!(opts.mode, FaxMode::T38Udptl);
    }
    
    #[test]
    fn test_fax_result_success() {
        let result = FaxResult::success(2, 45000);
        assert!(result.success);
        assert_eq!(result.pages_sent, 2);
        assert_eq!(result.duration_ms, 45000);
        assert!(result.error.is_none());
    }
    
    #[test]
    fn test_fax_result_failure() {
        let result = FaxResult::failure("Connection lost", 5000);
        assert!(!result.success);
        assert_eq!(result.pages_sent, 0);
        assert_eq!(result.error, Some("Connection lost".to_string()));
    }
}
