# Packet Fidelity Checks

Use these checks to validate packet fidelity guardrails locally and in CI.

## Local

Run the standard packet fidelity suite:

```bash
npm run test:packet-fidelity
```

This runs `scripts/run-packet-fidelity-checks.sh`, which includes:
- always-on packet fidelity scaffolding tests
- packet capture command-layer Rust tests

Optional differential scaffold path:

```bash
SIPALYZER_ENABLE_DIFFERENTIAL_TESTS=1 npm run test:packet-fidelity
```

When enabled, the script also runs an environment-gated differential decode scaffold test (and skips that part if `tshark`/`tcpdump` are unavailable).

## CI

`/.github/workflows/build-app.yml` runs:

```bash
bash ./scripts/run-packet-fidelity-checks.sh
```

on macOS build jobs so local and CI behavior stay aligned.
