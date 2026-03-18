# Troubleshooting Engine (VoIP UCaaS)

Last updated: 2026-03-03

This document summarizes the 2026 hardening pass for the SIP/FAX/RTP troubleshooting engine.

---

## Scope

The troubleshooting engine combines:

- softphone call state and SIP signaling
- registration health and registrar test history
- packet capture sessions (SIP dialogs, RTP streams)
- fax session metadata (including capture linkage)
- curated troubleshooting knowledge base and decision trees

Primary goals of this pass:

- improve diagnostic correctness
- make uncertainty explicit to end users
- increase resilience under large/active captures
- tighten security around support/export surfaces
- add guardrails to prevent future drift

---

## Diagnostic Accuracy Improvements

### SIP outcome interpretation

- Imported capture and live-trace analysis now distinguishes:
  - explicit non-2xx final outcomes (for example 486/603) vs
  - truly missing final INVITE response
- "No 200 OK" is no longer over-reported as a failure when a valid non-2xx final exists.

### Authentication loop detection

- Added detection for repeated 401/407 challenge loops without successful completion.
- This is surfaced as a high-severity troubleshooting hint.

### RTP quality coverage

- Jitter-only degradations are now included in poor-quality classification and findings.
- RTP metrics shown in findings and timelines include jitter-driven degradation paths.

### Symptom matching quality

- Knowledge-base matching no longer uses first-match-wins behavior.
- Matching signals are merged per article:
  - stronger relevance score is preserved
  - matched field sets are merged and deduplicated

### SIP/KB/decision-tree consistency

- Added missing article coverage (for example SIP 400 guidance).
- Decision tree routing corrected for SIP 603 vs 403 paths.

---

## Confidence and Uncertainty Model

Root-cause hints and findings now carry structured confidence metadata:

- `confidenceLevel`: `high | medium | low`
- `confidenceScore`: normalized score
- `uncertaintyState`: `certain | uncertain`
- `uncertaintyReasons`: user-readable reasons with reason codes

The UI surfaces this with explicit language such as:

- "High/Medium/Low confidence"
- "(not definitive)" when evidence is incomplete or conflicting

Uncertainty is explicitly raised for conditions like:

- no final SIP response observed
- call connected but no RTP evidence
- softphone failure without dialog evidence
- multiple competing hypotheses

---

## Performance and Scale Hardening

### Selective troubleshooting sync

Troubleshooting synchronization moved from broad store subscriptions to targeted slice subscriptions in `useTroubleshootingSync`, reducing unnecessary recomputation.

### Filtered packet query cache

Backend packet filtering now caches filtered/sorted index results for repeated queries:

- key includes session + filter + sort parameters
- bounded in-memory LRU-style cache
- stale protection includes packet count and packet-content fingerprints
  - avoids stale reuse when ring buffers rotate at fixed capacity

This preserves API behavior while significantly reducing repeated filter/sort work for high-frequency UI queries.

---

## Data Integrity and UX Fixes

- Imported PCAP sessions are stored and displayed as `Imported` (not `Stopped`).
- Import metadata now records parsed vs total packet counts in session description.
- Redundant import success notifications in Home activity were removed.
- Fax session to capture linkage is normalized via `captureSessionId`.
- Troubleshooting finding links now include fax center navigation.
- Decision-tree node detail text is rendered in the UI.
- Call-focused Home actions now trigger call trace selection for faster drill-down.

---

## Security Hardening

### External fetch safeguards

Provision/fetch commands now enforce:

- `http/https` only
- host required
- localhost/loopback blocked by default (override via env flag)
- strict maximum response sizes per command type

### Audit key management

Audit HMAC key is no longer hardcoded. It now resolves from:

1. environment override
2. persisted session state value
3. generated key fallback (persisted)

### Support package handling

Support package summary text is sanitized and length-capped.
Identifiers are masked by default in summary text (optional env override to include raw IDs).

---

## Guardrail Tests

A troubleshooting guardrail test suite validates:

- SIP response-code map article references are valid
- decision tree node and article references are valid
- symptom signal merge semantics remain stable

Run:

```bash
npm run test:troubleshooting
```

---

## Key Files

- `src/stores/troubleshootingStore.ts`
- `src/lib/troubleshootingEngine.ts`
- `src/lib/troubleshootingEngine.guardrails.test.ts`
- `src/components/troubleshooting/UnifiedTroubleshootingTool.tsx`
- `src/components/troubleshooting/TroubleshootingCenterTool.tsx`
- `src/hooks/useTroubleshootingSync.ts`
- `src/components/fax-center/FaxesView.tsx`
- `src/types/fax.ts`
- `src/data/troubleshootingKnowledgeBase.ts`
- `src/data/troubleshootingDecisionTrees.ts`
- `src-tauri/src/commands/packet_capture.rs`
- `src-tauri/src/commands/provision.rs`
- `src-tauri/src/core/audit.rs`

---

## Remaining Roadmap

The current engine is substantially hardened. Remaining larger initiatives:

- incremental backend filter/index architecture for very large capture workloads
- calibrated confidence model with deeper contradiction handling and explicit abstain states
