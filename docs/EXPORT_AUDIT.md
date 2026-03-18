# Export Functionality — Audit & Architecture

Last updated: 2026-02-22

## Architecture

All file exports use a single backend command, `save_export_file`, which:

1. Accepts content as base64 + a default filename, filter description, and extension
2. Opens the **native OS file dialog** (`rfd::FileDialog`) so the user picks the destination
3. Writes the decoded bytes to the chosen path
4. Returns the saved path (or an error if the user cancels)

PCAP exports use a dedicated `export_pcap` command that copies the raw capture file via the same native dialog pattern.

### Frontend helper

```typescript
import { saveExportFile, textToBase64 } from "@/api/packetCapture";

// Text-based export (JSON, CSV, HTML, TXT, TSV, CFG)
await saveExportFile("filename.json", textToBase64(jsonString), "JSON files", "json");

// Binary export (PNG from canvas)
const dataUrl = canvas.toDataURL("image/png");
const base64 = dataUrl.split(",")[1]!;
await saveExportFile("image.png", base64, "PNG images", "png");
```

### Rules

- **Every export must use `saveExportFile` or a dedicated Tauri command with `rfd::FileDialog`.**
  Never use `document.createElement("a")` / `URL.createObjectURL` / browser downloads.
- **Tauri 2 IPC uses camelCase.** Rust `snake_case` params auto-convert to camelCase on the JS side.
  Always pass camelCase keys in `invokeTauri()` calls.
- **Clipboard copy is not an export.** `navigator.clipboard.writeText()` for "Copy" buttons is fine.
- **Audio/image preview blobs are not exports.** `URL.createObjectURL` for playback or preview is fine.
- **Use shared HTML report styling for table exports.** Build HTML with `buildHtmlTableReport()` in `src/lib/exportHtml.ts` for app-consistent dark/glass report output.

---

## Export inventory

### Packet Capture

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Full PCAP | `ExportDialog.tsx` | `exportPcap()` | `export_pcap` | PCAP | Yes |
| Packets CSV/JSON/HTML | `ExportDialog.tsx` | `saveExportFile()` | `save_export_file` | CSV/JSON/HTML | Yes |
| Single dialog PCAP | `CallFlowTimelineView.tsx` | `exportDialogPcapSave()` | `export_dialog_pcap_save` | PCAP | Yes |
| SIP Ladder PNG | `SipLadderView.tsx` | `saveExportFile()` | `save_export_file` | PNG | Yes |
| RTP topology PNG | `RtpEndpointMap.tsx` | `saveExportFile()` | `save_export_file` | PNG | Yes |
| RTP audio WAV | `RtpAudioPlayer.tsx` | `rtp_stream_export_wav` | `rtp_stream_export_wav` | WAV | Yes |
| Combined stereo WAV | `CombinedStreamPlayer.tsx` | `saveExportFile()` | `save_export_file` | WAV | Yes |

### Registration

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Test results report | `ReportExportDialog.tsx` | `exportTestResults()` | `export_test_results` | HTML/PDF | Yes |

### Softphone

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| RTP stats JSON | `DiagnosticsView.tsx` | `saveExportFile()` | `save_export_file` | JSON | Yes |
| RTP stats CSV | `DiagnosticsView.tsx` | `saveExportFile()` | `save_export_file` | CSV | Yes |
| RTP stats HTML report | `DiagnosticsView.tsx` | `saveExportFile()` | `save_export_file` | HTML | Yes |
| Transcript TXT | `RecordingView.tsx` | `saveExportFile()` | `save_export_file` | TXT | Yes |

### Tools

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Syslog export | `SyslogView.tsx` | `saveExportFile()` | `save_export_file` | TXT | Yes |
| Log viewer export | `LogViewerView.tsx` | `saveExportFile()` | `save_export_file` | TXT | Yes |
| Provision config | `ProvisionDesigner.tsx` | `saveExportFile()` | `save_export_file` | CFG | Yes |
| Network devices scan | `network-devices/ExportDialog.tsx` | `saveExportFile()` | `save_export_file` | JSON/CSV/HTML | Yes |
| Network map PNG | `network-devices/NetworkMapView.tsx` | `saveExportFile()` | `save_export_file` | PNG | Yes |
| Composer collection | `ImportExport.tsx` | `saveExportFile()` | `save_export_file` | JSON | Yes |

### Admin

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Audit log | `AuditLogView.tsx` | `saveExportFile()` | `save_export_file` | TSV | Yes |
| Settings export | `ConfigAuditView.tsx` | `saveExportFile()` | `save_export_file` | JSON | Yes |
| Telemetry traces | `TelemetrySettings.tsx` | `saveExportFile()` | `save_export_file` | JSON | Yes |

### Remote Agent

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Activity CSV | `ActivityView.tsx` | `saveExportFile()` | `save_export_file` | CSV | Yes |
| Activity JSON | `ActivityView.tsx` | `saveExportFile()` | `save_export_file` | JSON | Yes |
| Activity HTML report | `ActivityView.tsx` | `saveExportFile()` | `save_export_file` | HTML | Yes |

### Troubleshooting

| What | Component | API | Backend Command | Format | Dialog |
|------|-----------|-----|-----------------|--------|--------|
| Support package | `ForensicsTool.tsx` | `createSupportPackage()` | `create_support_package` | PCAP+TXT | No (app internal dir) |

Support package hardening notes (2026-03):

- Summary content is sanitized and size-limited before write.
- Session and Call-ID values in `summary.txt` are masked by default.
- Raw IDs can be included intentionally via `SIPALYZER_SUPPORT_PACKAGE_INCLUDE_IDS=1`.

---

## Bugs fixed (2026-02-22)

### snake_case → camelCase in `invokeTauri()` calls

Tauri 2 auto-converts Rust `snake_case` params to `camelCase` on the JS side.
These API functions were sending snake_case keys, causing "missing required key" errors:

| File | Function | Fixed keys |
|------|----------|------------|
| `src/api/packetCapture.ts` | `saveExportFile()` | `default_name` → `defaultName`, `content_base64` → `contentBase64`, `filter_name` → `filterName` |
| `src/api/packetCapture.ts` | `exportDialogPcapBase64()` | `session_id` → `sessionId`, `dialog_index` → `dialogIndex` |
| `src/api/packetCapture.ts` | `exportDialogPcapSave()` | `session_id` → `sessionId`, `dialog_index` → `dialogIndex` |
| `src/api/packetCapture.ts` | `createSupportPackage()` | `session_id` → `sessionId`, `call_id` → `callId` |
| `src/api/registration.ts` | `exportTestResults()` | `registrar_ids` → `registrarIds`, `file_path` → `filePath` |
| `CombinedStreamPlayer.tsx` | inline `invoke()` | `base64` → `contentBase64`, added missing `filterName` + `extension` |

### Browser downloads → native file dialog

These exports were using `document.createElement("a")` + `URL.createObjectURL` (browser download to ~/Downloads with no destination choice). All converted to `saveExportFile()`:

- `DiagnosticsView.tsx` — RTP stats JSON + CSV
- `DiagnosticsView.tsx` — added RTP stats HTML report
- `TelemetrySettings.tsx` — telemetry traces JSON
- `ActivityView.tsx` — agent activity CSV + JSON (+ HTML report)
- `SyslogView.tsx` — syslog TXT
- `LogViewerView.tsx` — log file TXT
- `RtpEndpointMap.tsx` — RTP topology PNG
- `NetworkMapView.tsx` (network-devices) — network map PNG
- `RecordingView.tsx` — transcript TXT
- `AuditLogView.tsx` — audit log TSV
- `ConfigAuditView.tsx` — settings JSON
- `ImportExport.tsx` — composer collection JSON
- `ProvisionDesigner.tsx` — provision config CFG
- `network-devices/ExportDialog.tsx` — added HTML report option next to CSV/JSON
- `network-devices/ExportDialog.tsx` — added hidden column options panel:
  - defaults to core columns only
  - supports toggling optional columns (including repeated vendor-related fields)
  - supports “only include columns that have data” for cleaner generated reports
- `packet-capture/monitor/ExportDialog.tsx` — added hidden column options panel:
  - defaults to core packet columns
  - supports toggling advanced decoded column
  - supports “only include columns that have data” for cleaner CSV/JSON/HTML reports

### ExportDialog redesign

`src/components/packet-capture/monitor/ExportDialog.tsx` was redesigned:
- Format selector: radio buttons → 2×2 clickable format cards with icons + descriptions
- Removed bloated preview section (format samples, estimated size inline)
- Added clean summary bar (packet count + estimated size)
- Fixed filename timestamps (ISO with colons → clean `YYYYMMDD_HHmmss`)
- Added graceful handling of user-cancelled file dialogs (no error toast)
- Disabled export button when nothing to export
