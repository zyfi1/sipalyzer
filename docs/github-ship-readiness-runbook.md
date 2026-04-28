# GitHub + Branch Update Runbook

This is the practical update flow for this app, using your current channel model:

- `beta` = fast-moving integration branch and updater manifest host
- `rc` = release-candidate stabilization branch
- `main` = production/stable channel

## 1) One-time setup

- Authenticate GitHub CLI:
  - `gh auth login`
- Ensure GitHub Actions are enabled.
- Ensure default branch is `main`.
- Configure Actions secrets:
  - `TAURI_PRIVATE_KEY`
  - `TAURI_KEY_PASSWORD`
  - `TAURI_UPDATER_PUBKEY` (minisign public key line only; must match `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`)
- Keep the repository visibility as `public` (required for GitHub-hosted updater assets).

## 2) App and updater essentials

- Version must stay aligned in:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- App updater code is in:
  - `src-tauri/src/commands/updater.rs`
- Updater manifests are published to:
  - `updater/beta.json`
  - `updater/rc.json`
  - `updater/main.json`
- Runtime default updater base URL points at:
  - `https://raw.githubusercontent.com/zyfi1/sipalyzer/beta/updater`
- Updater release assets are hosted in GitHub Releases and referenced directly in updater manifests.

## 3) Tag policy (channel-aware)

- Beta tag: `vX.Y.Z-beta.N`
- RC tag: `vX.Y.Z-rc.N`
- Production tag (`main`): `vX.Y.Z`

GitHub workflow that builds/publishes releases:

- `.github/workflows/release-channels.yml`

## 4) Day-to-day branch flow

1. Start from `beta` for feature work.
2. Open PRs into `main` for protected quality checks (`CI Quality Gates`).
3. Merge approved work.
4. Cut channel tags from the commit you want to ship.
5. Use promotion workflow to move beta -> rc -> main tags.

## 5) Shipping flow (simple)

1. Create beta tag:
   - `git tag v1.4.0-beta.1`
   - `git push origin v1.4.0-beta.1`
2. In GitHub Actions, run `Release Channels` with:
   - `tag=v1.4.0-beta.1`
3. Validate beta build and in-app update checks.
4. Promote to RC using `Promote Release Channel`:
   - `source_tag=v1.4.0-beta.1`
   - `target_channel=rc`
5. Validate RC soak period.
6. Promote RC to production (`main`) with:
   - `source_tag=v1.4.0-rc.1`
   - `target_channel=main`

## 6) Rollback flow

Use `.github/workflows/rollback-stable.yml` with:

- `rollback_to_tag`: known-good tag (`vX.Y.Z` or `vX.Y.Z-rc.N`)
- `new_stable_tag`: replacement production tag (`vX.Y.Z`)

This republishes a known-good release commit under a new production tag.

## 7) Quality checks to require

Require these before merge to `main`:

- `Quality Gates` from `.github/workflows/build-app.yml`

Recommended branch protection options:

- Require pull request before merge
- Require status checks before merge
- Require linear history (optional)

## 8) Workflows and what they do

- `.github/workflows/build-app.yml`
  - CI gates (typecheck, tests, build, rust checks, strict lane)
- `.github/workflows/release-channels.yml`
  - Creates GitHub release artifacts and publishes updater manifests
- `.github/workflows/promote-release.yml`
  - Promotes existing tags between channels by creating new target tags
- `.github/workflows/rollback-stable.yml`
  - Reissues a stable release from a known-good commit

