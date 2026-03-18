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

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <production-owner/repo> <branch-name>"
  echo "Example: $0 my-org/sipalyzer release-ops-sync"
  exit 1
fi

PROD_REPO="$1"
BRANCH="$2"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Cloning ${PROD_REPO} into ${TMP_DIR}"
gh repo clone "${PROD_REPO}" "${TMP_DIR}/prod"

pushd "${TMP_DIR}/prod" >/dev/null
git checkout -b "${BRANCH}"
mkdir -p .github/workflows docs scripts/github
popd >/dev/null

cp .github/workflows/build-app.yml "${TMP_DIR}/prod/.github/workflows/build-app.yml"
cp .github/workflows/release-channels.yml "${TMP_DIR}/prod/.github/workflows/release-channels.yml"
cp .github/workflows/promote-release.yml "${TMP_DIR}/prod/.github/workflows/promote-release.yml"
cp .github/workflows/rollback-stable.yml "${TMP_DIR}/prod/.github/workflows/rollback-stable.yml"
cp docs/github-ship-readiness-runbook.md "${TMP_DIR}/prod/docs/github-ship-readiness-runbook.md"
cp scripts/github/bootstrap-staging.sh "${TMP_DIR}/prod/scripts/github/bootstrap-staging.sh"
cp scripts/github/promote-workflows-to-production.sh "${TMP_DIR}/prod/scripts/github/promote-workflows-to-production.sh"

pushd "${TMP_DIR}/prod" >/dev/null
git add .github/workflows docs scripts/github
git commit -m "Add ship-readiness GitHub workflows and runbook"
git push -u origin "${BRANCH}"
gh pr create \
  --title "Add ship-readiness CI/CD and release channel workflows" \
  --body "Promotes validated staging automation (CI gates, release channels, promotion, rollback) to production repository."
popd >/dev/null

echo "Opened PR in ${PROD_REPO} from branch ${BRANCH}."

