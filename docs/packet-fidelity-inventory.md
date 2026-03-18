# Packet Fidelity Inventory

This inventory classifies packet ingress/egress paths by fidelity class for the true packet capture implementation.

## Fidelity Classes

- `wire_captured`: captured from NIC/pcap source with raw frame bytes preserved.
- `wire_imported`: loaded from external pcap/pcapng and parsed from stored records.
- `derived`: computed/decoded metadata derived from captured bytes.
- `simulated`: synthetic or agent-supplied packet summaries without full raw frame bytes.

## Ingress Paths

- `src-tauri/src/packet_capture/capture.rs`
  - Local libpcap capture loop.
  - Current class: `wire_captured`.
  - Risk: currently writes reconstructed packets via `PcapWriter::write_packet`.

- `src-tauri/src/packet_capture/pipeline.rs`
  - Multi-threaded libpcap capture and parse pipeline.
  - Current class: `wire_captured`.
  - Risk: writer thread currently writes reconstructed packets via `PcapWriter::write_packet`.

- `src-tauri/src/packet_capture/remote_capture.rs`
  - Remote SSH `tcpdump -w -` stream relay.
  - Current class: `wire_captured` when raw pcap records are relayed.
  - Risk: any fallback path that reconstructs packet bytes downgrades fidelity.

- `src-tauri/src/commands/packet_capture.rs` `inject_agent_raw_frames`
  - Agent-sent raw frames (base64).
  - Intended class: `wire_captured`.
  - Risk: currently converted to `PacketInfo` and then written via synthetic `write_packet`.

- `src-tauri/src/commands/packet_capture.rs` `inject_agent_packet_infos`
  - Agent-sent packet JSON summaries.
  - Current class: `simulated`.
  - Risk: no full frame bytes; must never be treated as authoritative wire data.

- `src-tauri/src/commands/packet_capture.rs` `import_pcap*`
  - Imported file captures.
  - Current class: `wire_imported`.

## Egress Paths

- `src-tauri/src/packet_capture/pcap_writer.rs` `write_packet`
  - Current behavior: synthetic Ethernet/IP/UDP reconstruction from `PacketInfo`.
  - Current class: `simulated` output (not wire-faithful).
  - Required change: use raw record/frame write for authoritative output.

- `src-tauri/src/commands/packet_capture.rs` `export_pcap`
  - Current behavior: copies stored capture file for session.
  - Class depends on how file was written.

- `src-tauri/src/commands/packet_capture.rs` `export_dialog_pcap*`
  - Current behavior: writes selected packets with `write_packet` reconstruction.
  - Current class: `simulated` output.
  - Required change: explicit non-authoritative export labeling or raw-record-backed export only.

- `src/components/packet-capture/*`
  - UI packet list/details/raw tabs.
  - Current class: `derived` representation of underlying packets.
  - Required change: expose provenance/fidelity in UI.

## Immediate Guardrail Decisions

- Authoritative path must only include `wire_captured` and `wire_imported`.
- `inject_agent_packet_infos` remains supported as `simulated`, but excluded from authoritative exports/views by default.
- Any export path relying on synthetic reconstruction must be labeled non-authoritative or replaced.
