//! Enterprise softphone: media engine and call controller (SIP + RTP).

pub mod audio_processing;
pub mod blf;
pub mod call_controller;
pub mod codecs;
pub mod dtmf;
pub mod inbound;
pub mod jitter_buffer;
pub mod media_engine;
pub mod metrics;
pub mod moh;
pub mod mwi;
pub mod options_keepalive;
pub mod port_allocator;
pub mod prack;
pub mod presence;
pub mod rtp;
pub mod sdp;
pub mod sip_log;
pub mod sip_message;
pub mod transcription;

#[allow(unused_imports)]
pub use call_controller::{
    cancel_call, end_all_active_calls, end_call, hold_call, place_call, register_dialog_sender,
    run_bye_listener, run_tcp_bye_listener, send_attended_refer, send_refer, send_t38_reinvite,
    take_remote_ended_calls, OnBeforeInvite, PlaceCallResult,
};
pub use inbound::{
    answer_inbound_call, clear_registration_binding, reject_inbound_call, set_registration_binding,
    start_inbound_listener, stop_inbound_listener, sync_inbound_listeners,
};
#[allow(unused_imports)]
pub use media_engine::{
    delete_recording, get_call_jitter_history, get_call_metrics, get_call_waveform, is_recording,
    list_recordings, push_send_audio, read_recording_data, register_fax_receive, send_dtmf,
    set_audio_devices, set_fax_send_mode, set_input_gain, set_muted, start_media, start_recording,
    stop_media, stop_recording, unregister_fax_receive, RecordingInfo,
};
pub use mwi::{get_mwi_state, subscribe_mwi, unsubscribe_mwi, MwiState};
