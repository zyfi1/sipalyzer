//! Enterprise softphone: media engine and call controller (SIP + RTP).

pub mod rtp;
pub mod codecs;
pub mod jitter_buffer;
pub mod moh;
pub mod metrics;
pub mod media_engine;
pub mod sdp;
pub mod call_controller;
pub mod inbound;
pub mod dtmf;
pub mod audio_processing;
pub mod mwi;
pub mod transcription;
pub mod port_allocator;
pub mod sip_log;
pub mod options_keepalive;
pub mod blf;
pub mod sip_message;
pub mod presence;
pub mod prack;

#[allow(unused_imports)]
pub use media_engine::{start_media, stop_media, set_muted, set_input_gain, set_audio_devices, set_fax_send_mode, push_send_audio, register_fax_receive, unregister_fax_receive, get_call_metrics, get_call_jitter_history, get_call_waveform, send_dtmf, start_recording, stop_recording, is_recording, list_recordings, delete_recording, read_recording_data, RecordingInfo};
#[allow(unused_imports)]
pub use call_controller::{place_call, end_call, cancel_call, hold_call, send_refer, send_attended_refer, send_t38_reinvite, run_bye_listener, run_tcp_bye_listener, register_dialog_sender, take_remote_ended_calls, end_all_active_calls, PlaceCallResult, OnBeforeInvite};
pub use inbound::{
    answer_inbound_call, clear_registration_binding, reject_inbound_call,
    set_registration_binding, start_inbound_listener, stop_inbound_listener, sync_inbound_listeners,
};
pub use mwi::{subscribe_mwi, unsubscribe_mwi, get_mwi_state, MwiState};
