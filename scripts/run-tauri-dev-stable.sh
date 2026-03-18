#!/usr/bin/env bash
set -euo pipefail

# Keep dev builds in a dedicated Cargo target dir so they never contend
# with editor-triggered cargo check jobs (rust-analyzer/Cursor).
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-src-tauri/target/dev-run}"
# Incremental can wedge in hard-link setup on some macOS setups; disabling
# here favors predictable startup over incremental compile speed.
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
# Prevent non-source Cargo artifacts from triggering Tauri's Rust watcher loop.
# Keep explicit extra target dirs here because ad-hoc checks may write outside src-tauri/target.
export TAURI_CLI_WATCHER_IGNORE="src-tauri/target/**,src-tauri/target-packet-fidelity/**,src-tauri/target-agent-check/**,src-tauri/target-codex-check/**"

# Dev startup optimization:
# - skip full production build (can add minutes)
# - rely on Vite dev server + Rust compile only
# Set SIPALYZER_DEV_PREBUILD=1 to restore the old prebuild behavior.
if [[ "${SIPALYZER_DEV_PREBUILD:-0}" == "1" ]]; then
  npm run build
fi

# If a stale Vite instance is still bound to the dev port, tauri dev fails before boot.
# Clean up only local listeners on 127.0.0.1:1420 to avoid repeated "Port already in use" loops.
if command -v lsof >/dev/null 2>&1; then
  _vite_pids="$(lsof -tiTCP:1420 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${_vite_pids}" ]]; then
    echo "Found existing dev listener on :1420 — stopping stale process(es)..."
    for _pid in ${_vite_pids}; do
      kill "${_pid}" 2>/dev/null || true
    done
    sleep 1
    # Final fallback if a process ignores TERM.
    _still_listening="$(lsof -tiTCP:1420 -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${_still_listening}" ]]; then
      for _pid in ${_still_listening}; do
        kill -9 "${_pid}" 2>/dev/null || true
      done
    fi
  fi
fi

_vite_log="${TMPDIR:-/tmp}/sipalyzer-vite-dev.log"
npm run dev >"${_vite_log}" 2>&1 &
_vite_pid=$!

cleanup() {
  if [[ -n "${_vite_pid:-}" ]] && kill -0 "${_vite_pid}" 2>/dev/null; then
    kill "${_vite_pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${_vite_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

_deadline=$((SECONDS + 45))
while (( SECONDS < _deadline )); do
  if curl -fsS --max-time 2 "http://127.0.0.1:1420/" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${_vite_pid}" 2>/dev/null; then
    echo "Vite exited unexpectedly. Last logs:"
    tail -n 120 "${_vite_log}" || true
    exit 1
  fi
  sleep 1
done

if ! curl -fsS --max-time 2 "http://127.0.0.1:1420/" >/dev/null 2>&1; then
  echo "Timed out waiting for Vite dev server at 127.0.0.1:1420"
  tail -n 120 "${_vite_log}" || true
  exit 1
fi

echo "Vite dev server is healthy at http://127.0.0.1:1420"
tauri dev --no-watch --no-dev-server-wait --config '{"build":{"beforeDevCommand":"echo frontend dev server managed by run-tauri-dev-stable.sh"}}'
