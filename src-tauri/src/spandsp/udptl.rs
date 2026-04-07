//! Native SpanDSP UDPTL (ITU-T T.38 Annex D) wrapper.
//!
//! This module wraps SpanDSP's reference UDPTL encoder/decoder — the same
//! implementation used by FreeSWITCH, Asterisk, and other production virtual fax stacks.
//!
//! UDPTL carries T.38 IFP packets over UDP with optional error correction
//! (redundancy or FEC) per ITU-T T.38 Annex D / RFC 3362.
//!
//! ## Architecture
//! - **TX**: `encode(ifp)` → UDPTL packet bytes (ready to send over UDP)
//! - **RX**: `decode(udptl_bytes)` → decoded IFP packets delivered via callback

use std::os::raw::{c_int, c_void};
use std::sync::Mutex;

use super::bindings;

/// Maximum UDPTL packet size (MTU-safe)
pub const MAX_UDPTL_PACKET_SIZE: usize = 1400;

/// UDPTL error correction mode (maps to SpanDSP constants)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UdptlEcMode {
    /// No error correction
    None,
    /// Redundancy-based error correction (previous IFP packets repeated)
    Redundancy,
    /// Forward Error Correction (FEC)
    Fec,
}

impl Default for UdptlEcMode {
    fn default() -> Self {
        UdptlEcMode::Redundancy
    }
}

impl UdptlEcMode {
    /// Convert to SpanDSP's UDPTL_ERROR_CORRECTION_* constant
    fn to_spandsp(self) -> c_int {
        match self {
            UdptlEcMode::None => bindings::UDPTL_ERROR_CORRECTION_NONE,
            UdptlEcMode::Redundancy => bindings::UDPTL_ERROR_CORRECTION_REDUNDANCY,
            UdptlEcMode::Fec => bindings::UDPTL_ERROR_CORRECTION_FEC,
        }
    }
}

/// Shared state for the RX callback — collects decoded IFP packets.
struct RxCallbackState {
    /// Decoded IFP packets: (seq_no, ifp_bytes)
    packets: Mutex<Vec<(u16, Vec<u8>)>>,
}

/// Safe wrapper around SpanDSP's native UDPTL encoder/decoder.
///
/// This replaces our hand-rolled UDPTL with SpanDSP's battle-tested
/// reference implementation (the same code used by FreeSWITCH).
pub struct NativeUdptl {
    /// SpanDSP UDPTL state pointer
    state: *mut bindings::udptl_state_t,
    /// Shared RX callback state (Pin-stable for FFI)
    rx_state: Box<RxCallbackState>,
    /// TX packet buffer (reused to avoid allocation)
    tx_buf: Vec<u8>,
    /// TX sequence counter (for logging)
    tx_count: u32,
    /// RX packet counter (for logging)
    rx_count: u32,
}

// Safety: NativeUdptl is only used from a single thread (the T.38 session loop).
unsafe impl Send for NativeUdptl {}

/// FFI callback invoked by SpanDSP's `udptl_rx_packet` for each decoded IFP.
unsafe extern "C" fn udptl_rx_callback(
    user_data: *mut c_void,
    msg: *const u8,
    len: c_int,
    seq_no: c_int,
) -> c_int {
    if user_data.is_null() || msg.is_null() || len <= 0 {
        return -1;
    }

    let state = &*(user_data as *const RxCallbackState);
    let ifp = std::slice::from_raw_parts(msg, len as usize).to_vec();

    if let Ok(mut packets) = state.packets.lock() {
        packets.push((seq_no as u16, ifp));
    }

    0
}

impl NativeUdptl {
    /// Create a new UDPTL encoder/decoder using SpanDSP's native implementation.
    ///
    /// - `ec_mode`: Error correction scheme (Redundancy recommended)
    /// - `redundancy_entries`: Number of redundant packets to include (typically 3)
    pub fn new(ec_mode: UdptlEcMode, redundancy_entries: usize) -> Result<Self, String> {
        let rx_state = Box::new(RxCallbackState {
            packets: Mutex::new(Vec::new()),
        });

        let user_data = &*rx_state as *const RxCallbackState as *mut c_void;

        let state = unsafe {
            bindings::udptl_init(
                std::ptr::null_mut(), // allocate new
                ec_mode.to_spandsp(),
                1, // FEC span (only used for FEC mode)
                redundancy_entries as c_int,
                Some(udptl_rx_callback),
                user_data,
            )
        };

        if state.is_null() {
            return Err("Failed to initialize SpanDSP UDPTL".to_string());
        }

        // Set datagram limits
        unsafe {
            bindings::udptl_set_far_max_datagram(state, MAX_UDPTL_PACKET_SIZE as c_int);
            bindings::udptl_set_local_max_datagram(state, MAX_UDPTL_PACKET_SIZE as c_int);
        }

        tracing::info!(
            "Initialized native SpanDSP UDPTL: ec={:?}, entries={}",
            ec_mode,
            redundancy_entries
        );

        Ok(Self {
            state,
            rx_state,
            tx_buf: vec![0u8; MAX_UDPTL_PACKET_SIZE],
            tx_count: 0,
            rx_count: 0,
        })
    }

    /// Encode an IFP packet into a UDPTL packet (ready to send over UDP).
    ///
    /// Returns the encoded UDPTL packet bytes, or None on error.
    pub fn encode(&mut self, ifp_packet: &[u8]) -> Option<Vec<u8>> {
        if ifp_packet.is_empty() {
            return None;
        }

        let len = unsafe {
            bindings::udptl_build_packet(
                self.state,
                self.tx_buf.as_mut_ptr(),
                ifp_packet.as_ptr(),
                ifp_packet.len() as c_int,
            )
        };

        if len <= 0 {
            tracing::error!("udptl_build_packet failed for IFP len={}", ifp_packet.len());
            return None;
        }

        self.tx_count += 1;
        Some(self.tx_buf[..len as usize].to_vec())
    }

    /// Decode a received UDPTL packet and return all decoded IFP packets.
    ///
    /// SpanDSP's UDPTL decoder handles:
    /// - Primary IFP extraction
    /// - Redundancy-based recovery of lost packets
    /// - FEC recovery
    /// - Sequence number tracking
    ///
    /// Returns a Vec of `(seq_no, ifp_bytes)` — may contain multiple packets
    /// if redundancy recovered lost ones.
    pub fn decode(&mut self, udptl_packet: &[u8]) -> Vec<(u16, Vec<u8>)> {
        // Clear previous decoded packets
        if let Ok(mut packets) = self.rx_state.packets.lock() {
            packets.clear();
        }

        let result = unsafe {
            bindings::udptl_rx_packet(
                self.state,
                udptl_packet.as_ptr(),
                udptl_packet.len() as c_int,
            )
        };

        if result != 0 {
            if self.rx_count < 5 {
                tracing::error!(
                    "udptl_rx_packet failed (result={}), len={}",
                    result,
                    udptl_packet.len()
                );
            }
            return Vec::new();
        }

        self.rx_count += 1;

        // Collect decoded IFP packets from the callback
        if let Ok(mut packets) = self.rx_state.packets.lock() {
            std::mem::take(&mut *packets)
        } else {
            Vec::new()
        }
    }

    /// Get TX packet count
    pub fn tx_count(&self) -> u32 {
        self.tx_count
    }

    /// Get RX packet count
    pub fn rx_count(&self) -> u32 {
        self.rx_count
    }
}

impl Drop for NativeUdptl {
    fn drop(&mut self) {
        if !self.state.is_null() {
            unsafe {
                bindings::udptl_free(self.state);
            }
            self.state = std::ptr::null_mut();
        }
    }
}
