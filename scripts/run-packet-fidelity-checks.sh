#!/usr/bin/env bash
set -euo pipefail

echo "Running always-on packet verification scaffolding tests..."
cargo test \
  --manifest-path "src-tauri/Cargo.toml" \
  packet_capture::tests:: \
  -- --nocapture

echo "Running packet capture command-layer tests..."
cargo test \
  --manifest-path "src-tauri/Cargo.toml" \
  commands::packet_capture::tests:: \
  -- --nocapture

if [[ "${SIPALYZER_ENABLE_DIFFERENTIAL_TESTS:-0}" != "1" ]]; then
  echo "Differential decode scaffold disabled (set SIPALYZER_ENABLE_DIFFERENTIAL_TESTS=1 to enable)."
  exit 0
fi

if ! command -v tshark >/dev/null 2>&1 && ! command -v tcpdump >/dev/null 2>&1; then
  echo "Differential decode scaffold enabled but skipped: tshark/tcpdump not found."
  exit 0
fi

echo "Running env-enabled differential decode scaffold test..."
cargo test \
  --manifest-path "src-tauri/Cargo.toml" \
  packet_capture::tests::differential_decode_scaffold_is_explicitly_gated \
  -- --nocapture
