//! Fax commands module — Tauri command interface for fax operations.
//!
//! Fax sending commands are re-exported from spandsp::fax.
//! Inbound fax answer/reject commands delegate to the shared SIP inbound handler
//! but live here so faxing is fully independent of the softphone.

use tauri::command;
pub use crate::spandsp::fax::*;

/// Answer an inbound fax call: send 200 OK (T.38 SDP), wait ACK, start receive.
/// This is the fax-specific entry point — completely independent of the softphone commands.
#[command]
#[tracing::instrument(skip_all)]
pub async fn fax_answer_inbound_call(registrar_id: String, call_id: String) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "fax", "answer_inbound", "user", Some(&call_id), None,
    );
    crate::softphone::answer_inbound_call(registrar_id, call_id)
}

/// Reject an inbound fax call (e.g. 486 Busy Here).
#[command]
#[tracing::instrument(skip_all)]
pub async fn fax_reject_inbound_call(call_id: String, status_code: Option<u16>) -> Result<(), String> {
    let _ = crate::core::audit::AuditWriter::write_entry(
        "fax", "reject_inbound", "user", Some(&call_id), None,
    );
    crate::softphone::reject_inbound_call(call_id, status_code.unwrap_or(486))
}
