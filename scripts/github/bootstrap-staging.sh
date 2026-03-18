#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login"
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <owner/repo> [--private|--public]"
  echo "Example: $0 my-org/sipalyzer-staging --private"
  exit 1
fi

REPO="$1"
VISIBILITY="${2:---private}"

echo "Creating repository: ${REPO}"
gh repo create "${REPO}" "${VISIBILITY}" --source=. --remote=origin --push

echo "Enabling Actions and setting default branch protections recommendations..."
echo "Next manual step: configure branch protection required checks in GitHub UI."
echo "Recommended required check: Quality Gates"

echo "Done. Configure required secrets:"
echo "  - TAURI_PRIVATE_KEY"
echo "  - TAURI_KEY_PASSWORD"

