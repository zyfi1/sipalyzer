# GitHub Ship-Readiness Runbook

This runbook covers the minimum manual steps required while the automation handles the rest.

## 1) One-time prerequisites

- Install and authenticate GitHub CLI:
  - `gh auth login`
- Ensure repository has Actions enabled.
- Confirm default branch is `main`.

## 2) Recommended repository model

- Use two repositories:
  - staging: where release workflows are validated first
  - production: where validated workflows are promoted

## 3) Required secrets (full signing now)

Set in GitHub repository settings -> `Secrets and variables` -> `Actions`:

- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`

Optional platform signing secrets can be added later by platform policy.

## 4) Channel and tag policy

- Beta: `vX.Y.Z-beta.N`
- RC: `vX.Y.Z-rc.N`
- Stable: `vX.Y.Z`

Release workflow: `.github/workflows/release-channels.yml`

## 5) Normal release flow

1. Push beta tag, example:
   - `git tag v1.4.0-beta.1 && git push origin v1.4.0-beta.1`
2. Validate beta quality and soak.
3. Promote beta to RC with workflow:
   - `Promote Release Channel` (`source_tag=v1.4.0-beta.1`, `target_channel=rc`)
4. Validate RC soak window.
5. Promote RC to stable:
   - `Promote Release Channel` (`source_tag=v1.4.0-rc.1`, `target_channel=stable`)

## 6) Rollback flow

Use workflow `.github/workflows/rollback-stable.yml`:

- `rollback_to_tag`: known-good tag (stable or RC)
- `new_stable_tag`: next stable version tag to publish rollback (for example `v1.4.1`)

This creates a new stable tag from known-good commit and triggers standard stable release automation.

## 7) Branch protections (recommended required checks)

Require these checks before merge to `main`:

- `Quality Gates` from `.github/workflows/build-app.yml`

Enable:

- Require pull request before merging
- Require status checks to pass before merging
- Require linear history (optional but recommended)

## 8) Staging -> production cutover

1. Validate at least one full beta -> rc -> stable cycle in staging.
2. Mirror workflows and scripts to production repository.
3. Reconfigure production secrets.
4. Run first beta dry run in production.
5. Promote to RC and stable only after successful checks.

## 9) Where to operate

- CI gates: `.github/workflows/build-app.yml`
- Channel releases: `.github/workflows/release-channels.yml`
- Channel promotions: `.github/workflows/promote-release.yml`
- Stable rollback: `.github/workflows/rollback-stable.yml`

