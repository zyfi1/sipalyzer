# Bundled Native Artifacts Contract

This directory is the single source of truth for native engine artifacts used by
fax/STT native paths. Host-installed system libraries are not part of the
build contract.

## Layout

Artifacts are target-scoped:

- `vendor/libs/<target-triple>/...`
- Manifest: `vendor/libs/manifest.json`

Example targets:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

Each target directory must contain:

- native runtime libraries (platform-appropriate extension)
- `include/` headers required by bindgen/native compile path

## Validation

Run:

```bash
npm run validate:native-artifacts
```

To stage artifacts for the current host target from existing local native files:

```bash
npm run stage:native-artifacts
```

Or stage a specific target:

```bash
node ./scripts/stage-native-artifacts.mjs --target x86_64-pc-windows-msvc
```

To hydrate from an external prebuilt artifact store:

```bash
SIPALYZER_NATIVE_ARTIFACTS_DIR=/absolute/path/to/native-artifacts npm run hydrate:native-artifacts
```

To fetch a `.tar.gz` bundle first, then hydrate:

```bash
npm run fetch:native-artifacts -- --source https://example.com/native-artifacts.tar.gz --dest .tmp/native-artifacts
npm run hydrate:native-artifacts -- --source .tmp/native-artifacts
```

To auto-populate Linux/Windows native bundles from upstream releases:

```bash
npm run fetch:native-artifacts:upstream
```

This pulls:

- `spandsp` and `libtiff` from conda-forge packages
- `libvosk` from official vosk-api release archives

Expected source layout:

- `<source>/<target-triple>/<library files>`
- `<source>/<target-triple>/include/...`

Example:

- `/native-artifacts/x86_64-unknown-linux-gnu/libspandsp.so`
- `/native-artifacts/x86_64-unknown-linux-gnu/libtiff.so`
- `/native-artifacts/x86_64-unknown-linux-gnu/libvosk.so`
- `/native-artifacts/x86_64-unknown-linux-gnu/include/spandsp.h`

CI release lane:

- Set repository variable `SIPALYZER_NATIVE_ARTIFACTS_DIR` to the absolute path
  available on the runner where native bundles are mounted/restored.
- Or set repository variable `SIPALYZER_NATIVE_ARTIFACTS_URL` to a `.tar.gz`
  bundle URL containing target directories at archive root.
- The release workflow hydrates `vendor/libs/<target>` from that location before
  strict validation.
- If neither variable is set, CI falls back to `fetch:native-artifacts:upstream`
  to download Linux/Windows bundles directly from upstream package sources.
- Hermetic policy: all non-packet-capture native bundles are required for
  release across configured targets.
- Windows (`x86_64-pc-windows-msvc`) must include `spandsp.dll`, `tiff.dll`,
  `vosk.dll`, and Vosk runtime dependencies
  (`libstdc++-6.dll`, `libgcc_s_seh-1.dll`, `libwinpthread-1.dll`) for release.
- Linux (`x86_64-unknown-linux-gnu`) must include `libspandsp.so`,
  `libtiff.so`, and `libvosk.so` for release.

Strict mode (fails on missing files):

```bash
node ./scripts/validate-native-artifacts.mjs --strict
```

Strict mode honors `requiredForRelease` in `manifest.json`. To force-check all
targets regardless of policy:

```bash
node ./scripts/validate-native-artifacts.mjs --strict --enforce-all
```

## Build behavior

- Default app build does **not** require native extensions.
- Native extension builds (`--features native_extensions`) resolve libraries only
  from the target-scoped bundled directory.
- No Homebrew/system-path probing is part of this contract.
- Packet capture is the only explicit host dependency exception (Npcap/libpcap
  + permissions/driver access).
