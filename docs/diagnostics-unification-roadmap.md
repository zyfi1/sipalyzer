# Diagnostics & troubleshooting unification roadmap

**Status:** incremental (2026). Complements `docs/troubleshooting-engine.md` and `docs/packet-fidelity-inventory.md`.

## Problem statement

The app reasons about VoIP health through several parallel paths:

| Layer | Role | Location |
| ----- | ---- | -------- |
| **Troubleshooting store** | Registration health, softphone calls, capture sessions → timeline, root-cause hints, KB/decision trees | `src/stores/troubleshootingStore.ts`, `useTroubleshootingSync.ts` |
| **Troubleshooting engine** | Symptom → article matching | `src/lib/troubleshootingEngine.ts` |
| **Diagnostics (TS)** | Dialog/RTP/session-oriented rules + explanations | `src/lib/diagnostics/*`, `types/diagnostics.ts` |
| **Expert analyzer (Rust)** | Packet-level rules (ALG, fragmentation, T.38, registration flood, …) | `src-tauri/src/packet_capture/expert_analyzer.rs` |
| **Per-feature UI** | Registration DNS/TCP badges, softphone metrics, network test “VoIP diagnostics” | `DiagnosticsDisplay.tsx`, `DiagnosticsView.tsx`, `networkTestStore` |

Prior gap: the **Rust** expert path was implemented and exposed as `get_expert_findings` but the UI pipeline only ran the **TypeScript** analyzers, so packet-native checks never surfaced in the same findings list as dialog-based checks.

## What we standardized (capture path)

1. **Single merge pipeline** — `src/lib/diagnostics/captureAnalysisPipeline.ts`
   - Runs **TypeScript** and **Rust** diagnostics in **parallel** (`Promise.allSettled`).
   - **Retries** on the IPC/Rust path (`withRetries`) for transient failures.
   - **Partial success**: if one engine fails, the other’s findings still return.
   - **Dedupes** overlapping rows by `ruleId` + normalized `title` + `relatedCallId`, keeping the stricter severity.
   - **Sorts** by severity, then confidence, then time.

2. **Public API** — `src/lib/diagnostics/query.ts`
   - `getAnalysisDiagnostics(sessionId)` → merged `ExpertFinding[]` (existing call sites unchanged).
   - `getAnalysisDiagnosticsDetailed(sessionId)` → `{ findings, meta }` with per-engine counts and errors (for future UI banners / telemetry).

## Real-world domains to keep explicit

When extending rules or KB links, tag work to one or more of:

- **Registration** — 401/407 loops, expiry, NAT binding, multi-contact, TLS/SIPS, wrong realm, OPTIONS/keepalive.
- **Calling / signaling** — INVITE transactions, PRACK, early media, 3xx/4xx/5xx semantics, session timers, mid-call re-INVITE.
- **Media (RTP/RTCP)** — one-way audio, codec mismatch, PT clock skew, DSCP, RTCP XR / quality hints where available.
- **FoIP** — T.38 re-INVITE, UDPTL loss, G.711 pass-through timing, false fax tone detection.
- **Network / security** — DNS/TCP reachability (registration diagnostics), TLS downgrade, fragmentation, SIP ALG signatures, private SDP addresses.

Edge cases to document in findings (not hide): **SIP ALG**, **NAT timeout**, **incomplete capture scope**, **simulated agent summaries** (see packet fidelity docs).

## Resiliency checklist (ongoing)

- [x] Capture diagnostics: parallel engines + retries + partial merge.
- [ ] Surface `CaptureDiagnosticsRunMeta.partial` in Capture / Forensics UI (banner when one engine failed).
- [ ] Align `VOIP_QUALITY_THRESHOLDS` (`diagnostics/analyzers.ts`) with canonical `VOIP_THRESHOLDS` (`voipThresholds.ts`) or document intentional deltas.
- [x] Extend `TroubleshootingSyncPayload` with **network test** summary via `buildNetworkSyncPayload` / `networkStoreSignature` → timeline + findings (`src/lib/troubleshooting/networkInsights.ts`).
- [ ] Optional: Prometheus-style counters for `diagnostics_engine_failures_total{engine="rust|ts"}` if/when a metrics endpoint exists.

## Tests

- `src/lib/diagnostics/captureAnalysisPipeline.test.ts` — merge/dedupe/sort behavior.
- Existing `engine.test.ts` — TS-only report stability.

```bash
npm run test -- src/lib/diagnostics/captureAnalysisPipeline.test.ts
```
