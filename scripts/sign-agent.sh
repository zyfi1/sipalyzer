#!/bin/bash
# sign-agent.sh — Code signing script for the SIPalyzer Remote Agent
#
# Usage:
#   ./scripts/sign-agent.sh <platform> <binary_path>
#
# Environment variables:
#   APPLE_DEVELOPER_ID    — Apple Developer ID certificate name (macOS)
#   APPLE_ID              — Apple ID email for notarization (macOS)
#   APPLE_APP_PASSWORD    — App-specific password for notarization (macOS)
#   APPLE_TEAM_ID         — Apple Developer Team ID (macOS)
#   WINDOWS_CERT_PATH     — Path to .pfx certificate (Windows)
#   WINDOWS_CERT_PASSWORD — Certificate password (Windows)

set -euo pipefail

PLATFORM="${1:-}"
BINARY="${2:-}"

if [ -z "$PLATFORM" ] || [ -z "$BINARY" ]; then
  echo "Usage: $0 <macos|windows|linux> <binary_path>"
  exit 1
fi

case "$PLATFORM" in
  macos)
    echo "=== macOS Code Signing ==="

    if [ -z "${APPLE_DEVELOPER_ID:-}" ]; then
      echo "WARNING: APPLE_DEVELOPER_ID not set. Skipping signing."
      exit 0
    fi

    # Sign the binary
    echo "Signing $BINARY with Developer ID: $APPLE_DEVELOPER_ID"
    codesign --deep --force --options runtime \
      --sign "$APPLE_DEVELOPER_ID" \
      --timestamp \
      "$BINARY"

    echo "Verifying signature..."
    codesign --verify --deep --strict "$BINARY"

    # If this is a .app bundle, also notarize
    if [[ "$BINARY" == *.app ]]; then
      echo "Creating zip for notarization..."
      ZIP_PATH="${BINARY%.app}.zip"
      ditto -c -k --keepParent "$BINARY" "$ZIP_PATH"

      echo "Submitting for notarization..."
      xcrun notarytool submit "$ZIP_PATH" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

      echo "Stapling notarization ticket..."
      xcrun stapler staple "$BINARY"

      rm "$ZIP_PATH"
    fi

    echo "macOS signing complete."
    ;;

  windows)
    echo "=== Windows Authenticode Signing ==="

    if [ -z "${WINDOWS_CERT_PATH:-}" ]; then
      echo "WARNING: WINDOWS_CERT_PATH not set. Skipping signing."
      exit 0
    fi

    # Sign using signtool (requires Windows SDK)
    echo "Signing $BINARY..."
    signtool sign /f "$WINDOWS_CERT_PATH" \
      /p "$WINDOWS_CERT_PASSWORD" \
      /t http://timestamp.digicert.com \
      /d "SIPalyzer Remote Agent" \
      /du "https://sipalyzer.com" \
      "$BINARY"

    echo "Verifying signature..."
    signtool verify /pa "$BINARY"

    echo "Windows signing complete."
    ;;

  linux)
    echo "=== Linux GPG Signing ==="

    # Optional: create detached GPG signature
    if command -v gpg &>/dev/null; then
      echo "Creating GPG detached signature for $BINARY..."
      gpg --detach-sign --armor "$BINARY"
      echo "Signature: ${BINARY}.asc"
    else
      echo "gpg not available. Skipping signature."
    fi

    echo "Linux signing complete."
    ;;

  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac
