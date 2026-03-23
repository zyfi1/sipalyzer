/**
 * Central tooltip reference — single source for consistent tooltip copy and descriptions.
 * Use with TooltipWrapper via content from getTooltip() or pass title/description directly.
 */

export interface TooltipEntry {
  title: string;
  description?: string;
}

/** Flattened key → TooltipEntry for type-safe lookup and reuse. */
export const tooltips = {
  // ——— Layout ———
  sidebarExpand: { title: "Expand sidebar", description: "Show tool names and navigation" },
  sidebarCollapse: { title: "Collapse sidebar", description: "Show icons only to save space" },
  headerLocalIp: {
    title: "Local IP",
    description: "Your machine's IP on this network. Click to refresh.",
  },
  headerSearch: { title: "Search (⌘K)", description: "Search registrars, notes, and more" },
  headerNotifications: { title: "Notifications (⌘⇧M)", description: "View, filter, and manage notifications from all tools" },
  headerNotes: { title: "Notes", description: "Open quick notes" },
  headerSettings: { title: "Settings", description: "Notifications, User-Agent, and more" },
  headerCustomize: { title: "Customize Header…", description: "Show, hide, and reorder header elements" },
  settingsHeaderTab: { title: "Header", description: "Customize which elements appear in the header and their order" },

  // ——— Registration ———
  regAddRegistrar: { title: "Add registrar", description: "Create a new SIP registrar to test" },
  regRefreshStatus: { title: "Refresh status", description: "Re-check registration state and tests" },
  regRefreshAll: { title: "Refresh all", description: "Refresh status for all registrars" },
  regExportReport: { title: "Export report", description: "Download status or health report" },
  regExportHealth: { title: "Export health report", description: "Download registration health report" },
  regRegister: { title: "Register", description: "Register to the SIP server" },
  regUnregister: { title: "Unregister", description: "Unregister from the SIP server" },
  regRunTests: { title: "Run tests", description: "Run registration and health checks" },
  regHideTestPanel: { title: "Hide test panel", description: "Collapse the test results panel" },
  regNotes: { title: "Notes", description: "View or add notes for this registrar" },
  regEdit: { title: "Edit", description: "Edit registrar settings" },
  regDelete: { title: "Delete", description: "Remove this registrar" },
  regDeleteSelected: (n: number) =>
    ({ title: `Delete ${n} selected`, description: "Remove selected registrars" } as TooltipEntry),
  regRefreshSelected: (n: number) =>
    ({ title: `Refresh ${n} selected`, description: "Refresh status for selected registrars" } as TooltipEntry),
  regViewList: { title: "List view", description: "Show registrars in a list" },
  regViewTiles: { title: "Tile view", description: "Show registrars as tiles" },
  regClearResults: { title: "Clear results", description: "Clear all stored test results for this registrar" },
  regClearResultsShort: { title: "Clear test results", description: "Remove all test run history" },
  regTestConfigTimeout: {
    title: "Timeout",
    description: "Maximum time to wait for a response before timing out",
  },
  regTestConfigRetries: {
    title: "Retries",
    description: "Number of retries on failure. Set to 0 to disable",
  },
  regTestConfigRetryDelay: {
    title: "Retry delay",
    description: "Delay in milliseconds between retry attempts",
  },
  regTestType: { title: "Test type", description: "Kind of registration or health check" },
  regTestStatus: { title: "Status", description: "Pass or fail for this test" },
  regTestCode: { title: "Status code", description: "HTTP or SIP response code" },
  regTestResponseTime: { title: "Response time", description: "Time taken for the request" },
  regTestNotes: { title: "Notes", description: "Additional notes for this result" },
  regAllPassed: { title: "All tests passed", description: "Every check completed successfully" },
  regSomeFailed: (n: number) =>
    ({ title: `${n} test(s) failed`, description: "One or more checks failed" } as TooltipEntry),
  regTimestamp: { title: "Test run time", description: "When this test batch was run" },

  // ——— Registrar fields (list cards + editor) ———
  regSipIdentity: {
    title: "SIP identity (AOR)",
    description: "Address of Record: username@domain. This is how the SIP server identifies this client (used in From, To, Contact).",
  },
  regTransport: {
    title: "Transport",
    description: "Protocol used for SIP signaling: UDP (default, 5060), TCP, TLS (encrypted), or WSS (WebSocket Secure). Must match the server.",
  },
  regRemotePort: {
    title: "Remote port",
    description: "Port on the SIP server (usually 5060 for UDP/TCP, 5061 for TLS). REGISTER and other requests are sent here.",
  },
  regLocalPort: {
    title: "Local port",
    description: "Port on this machine to send SIP from. Leave empty for auto. Must be free; the app checks availability.",
  },
  regListeningPort: {
    title: "Listening port (inbound)",
    description: "Port for receiving inbound SIP (e.g. INVITEs). Used in REGISTER Contact so the server can reach this client. Often 5062 or similar.",
  },
  regRtpPort: {
    title: "RTP port (media)",
    description: "Pin a specific local UDP port for RTP media (SDP m= line). Leave blank for automatic allocation from the pool (Settings → Network).",
  },
  regStatusBadge: {
    title: "Registration status",
    description: "Whether this registrar is currently registered, unregistered, or failed. Based on last REGISTER response or test run.",
  },
  regResultStatusCode: {
    title: "SIP response code",
    description: "Last response from the server (e.g. 200 OK = success, 401 = auth required, 403 = forbidden).",
  },
  regResultResponseTime: {
    title: "Response time",
    description: "Time in milliseconds from sending the request until the response was received. Lower is better.",
  },
  regResultExpires: {
    title: "Expires",
    description: "Registration expiry in seconds. The client re-registers before this to stay registered.",
  },
  // Registrar editor form labels
  regEditorName: {
    title: "Name",
    description: "Friendly label for this registrar (e.g. \"Office PBX\"). Used only in the UI.",
  },
  regEditorDomain: {
    title: "Domain / IP",
    description: "SIP server hostname or IP address. Used in the Request-URI and Via. Examples: sip.example.com, 192.168.1.1.",
  },
  regEditorUsername: {
    title: "Username",
    description: "SIP username (often same as extension). Used in From, To, and authentication.",
  },
  regEditorPassword: {
    title: "Password",
    description: "SIP password for authentication. Stored securely. Required for REGISTER when the server challenges (401).",
  },
  regEditorRealm: {
    title: "Realm (optional)",
    description: "Authentication realm. Leave empty to use the domain. Some servers require a specific realm in 401 challenges.",
  },
  regEditorRemotePort: {
    title: "Remote port",
    description: "Port on the SIP server (typically 5060 for UDP/TCP, 5061 for TLS). Must match the server's listening port.",
  },
  regEditorLocalPort: {
    title: "Local port",
    description: "Port on this machine to bind for outbound SIP. Auto-assigned if empty. Must be available (app checks).",
  },
  regEditorTransport: {
    title: "Transport",
    description: "UDP (default), TCP, TLS, or WSS. Must match what the server supports. TLS/WSS use encryption.",
  },
  regEditorListeningPort: {
    title: "Listening port (inbound)",
    description: "Port for receiving inbound SIP (e.g. INVITEs). Put in REGISTER Contact so the server can reach you.",
  },
  regEditorRtpPort: {
    title: "RTP port (media)",
    description: "Pin a specific local UDP port for RTP. Leave blank for dynamic allocation from the port pool (Settings → Network).",
  },
  regEditorRegisterInterval: {
    title: "Register interval (seconds)",
    description: "How often to re-register. Empty = default (often 3600). Shorter values keep NAT bindings alive.",
  },
  regEditorTimeout: {
    title: "Timeout (seconds)",
    description: "Max time to wait for a response from the server before failing the request.",
  },
  regEditorRetry: {
    title: "Retry count",
    description: "Number of retries on failure (e.g. timeout or 5xx). 0 = no retries.",
  },

  // ——— Packet capture ———
  captureStart: { title: "Start capture", description: "Begin capturing packets on the selected interface. Requires a session name and interface." },
  captureStop: { title: "Stop capture", description: "Stop the active capture. Packets already captured are saved." },
  captureFilter: { title: "Display filter", description: "Wireshark-style BPF filter applied after capture. Filters the displayed packets without affecting what's captured." },
  captureInvalidFilter: (msg: string) => ({ title: "Invalid filter", description: msg } as TooltipEntry),
  captureImportPcap: { title: "Import PCAP", description: "Load a PCAP file from disk into a new capture session." },
  captureExport: { title: "Export", description: "Export packets to PCAP, JSON, or CSV. Useful for sharing with Wireshark or other tools." },
  captureBookmarks: { title: "Bookmarks", description: "Saved packet positions for quick navigation during analysis." },
  captureSavedFilters: { title: "Saved filters", description: "Reuse previously saved display filters for common analysis patterns." },
  captureRtpStreams: { title: "RTP streams", description: "Real-time Transport Protocol media streams: SSRC, codec, jitter, loss, and MOS quality." },
  captureStatistics: { title: "Statistics", description: "Protocol distribution, packet rates, top talkers, and bandwidth utilisation." },
  captureRefresh: { title: "Refresh", description: "Reload packet data from the capture session." },
  captureRecent: { title: "Recent captures", description: "Previously completed capture sessions." },
  captureScheduled: { title: "Scheduled captures", description: "Configure timed or recurring captures that start automatically." },

  // Capture controls
  captureSelectInterface: { title: "Select interface", description: "Choose the network interface to capture on. Pick the one that carries your SIP/RTP traffic." },
  captureAutoSelect: { title: "Auto-select interface", description: "Automatically picks the interface matching your local IP address." },
  captureRefreshInterfaces: { title: "Refresh interfaces", description: "Re-scan available network interfaces on this machine." },
  captureConfigureFilters: { title: "Configure filters", description: "Set advanced capture filters for protocols, IP ranges, and port ranges before starting." },
  captureSessionName: { title: "Session name", description: "A descriptive label for this capture session (e.g. 'SIP Registration Test')." },
  captureSessionDesc: { title: "Description", description: "Optional notes about the purpose of this capture." },

  // Monitor toolbar
  captureAutoScroll: { title: "Auto-scroll", description: "Automatically scroll to the newest packets as they arrive. Turn off to freeze the view." },
  captureAutoScrollOn: { title: "Auto-scroll: ON", description: "Automatically scrolling to newest packets. Click to freeze the view." },
  captureAutoScrollOff: { title: "Auto-scroll: OFF", description: "View is frozen at current position. Click to resume auto-scrolling." },
  capturePanelLayout: { title: "Detail panel", description: "Change the position of the packet details panel (right, left, bottom, top, or hidden)." },
  captureClear: { title: "Clear packets", description: "Remove all displayed packets from the view. Does not delete from the session." },
  capturePacketCount: (shown: number, total?: number) => ({
    title: `${shown.toLocaleString()} packets`,
    description: total !== undefined && total !== shown
      ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} total packets (filter active).`
      : "Total packets captured in this session.",
  } as TooltipEntry),

  // VoIP protocol filter
  captureProtocolSip: { title: "SIP", description: "Session Initiation Protocol — call setup, registration, and teardown signaling." },
  captureProtocolRtp: { title: "RTP", description: "Real-time Transport Protocol — carries audio/video media streams." },
  captureProtocolRtcp: { title: "RTCP", description: "RTP Control Protocol — quality feedback: jitter, loss, round-trip time." },
  captureProtocolFax: { title: "FAX / T.38", description: "T.38 fax-over-IP — real-time fax relay over UDP or TCP." },
  captureVoipToggle: { title: "VoIP filter", description: "Toggle between showing all packets or only VoIP protocols (SIP, RTP, RTCP, FAX)." },

  // Captures view
  captureDeleteAll: { title: "Delete all saved", description: "Permanently remove all saved (stopped) capture sessions." },
  captureRename: { title: "Rename", description: "Change the name of this capture session." },
  captureView: { title: "View in monitor", description: "Open this session in the live packet monitor." },
  capturePreview: { title: "Preview", description: "Quick-look at the first packets without opening the full monitor." },
  captureOpen: { title: "Open", description: "Load this saved session into the packet monitor." },
  captureDeleteSession: { title: "Delete session", description: "Permanently remove this capture session and its PCAP file." },
  captureQuickView: { title: "Quick view", description: "Peek at packets in a modal without leaving the current view." },
  captureOpenFull: { title: "Open in viewer", description: "Open this session in the full packet viewer." },
  captureExportPcap: { title: "Export PCAP", description: "Save packets to a PCAP file for analysis in Wireshark or similar tools." },

  // Scheduled captures
  captureScheduleNew: { title: "Schedule capture", description: "Create a new timed capture that starts automatically at a set time." },
  captureScheduleToggle: (enabled: boolean) => ({
    title: enabled ? "Disable schedule" : "Enable schedule",
    description: enabled ? "Pause this scheduled capture without deleting it." : "Re-activate this scheduled capture.",
  } as TooltipEntry),
  captureScheduleDelete: { title: "Delete schedule", description: "Remove this scheduled capture." },
  captureScheduleOneTime: { title: "One-time", description: "Capture runs once at the scheduled time." },
  captureScheduleRecurring: { title: "Recurring (daily)", description: "Capture repeats daily at the scheduled time." },

  // Packet details
  captureDetailOverview: { title: "Overview", description: "Summary of source, destination, protocol, size, and timestamps." },
  captureDetailProtocol: { title: "Protocol", description: "Decoded protocol layers (Ethernet → IP → UDP/TCP → SIP/RTP)." },
  captureDetailRaw: { title: "Raw", description: "Hex dump and raw byte view of the packet." },
  captureCopyValue: { title: "Copy", description: "Copy this value to the clipboard." },

  // RTP streams
  captureRtpSsrc: { title: "SSRC", description: "Synchronization Source identifier — uniquely identifies an RTP stream." },
  captureRtpCodec: { title: "Codec", description: "Audio/video codec (e.g. G.711, G.729)." },
  captureRtpSource: { title: "Source", description: "IP address and port sending RTP packets." },
  captureRtpDest: { title: "Destination", description: "IP address and port receiving RTP packets." },
  captureRtpPackets: { title: "Packets", description: "Total RTP packets in this stream." },
  captureRtpLost: { title: "Lost", description: "Packets lost (detected via sequence gaps)." },
  captureRtpLossPercent: { title: "Loss %", description: "Percentage of packets lost. >1% may degrade voice quality." },
  captureRtpJitter: { title: "Jitter", description: "Inter-arrival time variation in ms. Lower is better; >30ms may cause audio artefacts." },
  captureRtpMos: { title: "MOS", description: "Mean Opinion Score (1–4.5). 4.0+ is good, 3.5–4.0 acceptable, <3.5 poor." },

  // Export dialog
  captureExportCsv: { title: "CSV", description: "Comma-separated values. Opens in Excel, Google Sheets, or any spreadsheet app." },
  captureExportJson: { title: "JSON", description: "Structured data for programmatic analysis or custom tooling." },
  captureExportHtml: { title: "HTML Report", description: "Formatted web page with a table of all packets — share or print." },
  captureExportPcapFormat: { title: "PCAP (Wireshark)", description: "Binary packet capture compatible with Wireshark, tcpdump, and other tools." },
  captureExportIncludeDecoded: { title: "Include decoded fields", description: "Add parsed protocol details (SIP headers, RTP fields) to the export." },
  captureExportFiltered: { title: "Export filtered", description: "Only export packets matching the current filter. Uncheck to export all." },

  // Bookmarks
  captureBookmarkJump: { title: "Jump to packet", description: "Scroll the packet list to this bookmarked packet." },
  captureBookmarkDelete: { title: "Delete bookmark", description: "Remove this bookmark." },

  // Packet details tabs
  captureTabOverview: { title: "Overview", description: "Summary of source, destination, protocol, size, and timestamps." },
  captureTabProtocol: { title: "Protocol", description: "Decoded protocol layers: Ethernet → IP → UDP/TCP → Application." },
  captureTabRaw: { title: "Raw", description: "Hex dump and ASCII view of the raw packet bytes." },

  // Performance bar
  captureFps: { title: "UI Frame Rate", description: "Rendering performance of the packet list. Target: 60 FPS." },
  capturePacketRate: { title: "Packet Rate", description: "Packets captured per second from the network interface." },
  captureDropRate: { title: "Drop Rate", description: "Percentage of packets dropped. Green < 1% (healthy), Yellow 1–5% (warning), Red > 5% (critical)." },
  captureQueueStatus: { title: "Pipeline Queue", description: "Buffer fill level between capture and parse stages. High fill = backpressure." },
  captureMode: (isPipeline: boolean) => ({
    title: isPipeline ? "Pipeline Mode" : "Standard Mode",
    description: isPipeline
      ? "High-performance multi-threaded capture pipeline with ring buffers."
      : "Single-threaded capture suitable for low-volume traffic.",
  } as TooltipEntry),

  // Live stats
  captureTotalPackets: { title: "Total Packets", description: "Cumulative count of all captured packets since session start." },
  captureTotalBytes: { title: "Total Bytes", description: "Cumulative bytes captured. Includes headers and payload." },
  captureBandwidth: { title: "Bandwidth", description: "Current data throughput from the capture interface." },
  captureProtocolDist: { title: "Protocol Distribution", description: "Breakdown of captured packets by protocol type." },
  captureTopSources: { title: "Top Sources", description: "IP addresses generating the most outgoing traffic." },
  captureTopDests: { title: "Top Destinations", description: "IP addresses receiving the most incoming traffic." },
  capturePipelinePerf: { title: "Pipeline Performance", description: "Internal metrics for the multi-threaded capture pipeline." },

  // Filter panel
  captureFilterSearch: { title: "Search", description: "Full-text search across packet summaries, IPs, and protocols." },
  captureFilterClearAll: { title: "Clear all filters", description: "Reset all active filters to show every packet." },
  captureFilterExpand: { title: "Advanced filters", description: "Toggle advanced filtering by source/destination IP, port, and size." },
  captureFilterSrcIp: { title: "Source IP", description: "Filter by the sending IP address (e.g. 192.168.1.1)." },
  captureFilterDstIp: { title: "Destination IP", description: "Filter by the receiving IP address." },
  captureFilterSrcPort: { title: "Source Port", description: "Filter by the sender's port number." },
  captureFilterDstPort: { title: "Destination Port", description: "Filter by the receiver's port number (e.g. 5060 for SIP)." },
  captureFilterMinSize: { title: "Min Size", description: "Exclude packets smaller than this byte count." },
  captureFilterMaxSize: { title: "Max Size", description: "Exclude packets larger than this byte count." },

  // Wireshark filter bar
  captureWiresharkFilter: { title: "Wireshark Display Filter", description: "Wireshark-compatible syntax: type for auto-complete, use the book icon for a full reference." },
  captureFilterReference: { title: "Filter Reference", description: "Look up field names, operators, and examples for Wireshark display filters." },
  captureFilterClear: { title: "Clear filter", description: "Remove the current display filter." },
  captureFilterValid: { title: "Filter valid", description: "This filter expression is syntactically correct." },

  // Packet capture tool main tabs
  captureTabViewer: { title: "Viewer", description: "Open and view multiple capture sessions side-by-side with tabs." },
  captureTabMonitor: { title: "Monitor", description: "Live packet capture monitor with real-time protocol analysis." },
  captureTabAnalysis: { title: "Analysis", description: "Call analysis — SIP signaling ladder and RTP media quality." },
  captureTabCaptures: { title: "Captures", description: "Browse, preview, and manage saved capture sessions." },
  captureTabRemote: { title: "Remote", description: "Capture packets from remote hosts via SSH, similar to Wireshark sshdump." },
  captureTabScheduled: { title: "Scheduled", description: "Schedule timed or recurring captures that start automatically." },

  // CaptureViewer / CapturePreviewModal
  captureBack: { title: "Back", description: "Return to the previous view." },
  captureLoadMore: { title: "Load more", description: "Fetch the next batch of packets from this capture." },
  captureClosePreview: { title: "Close", description: "Close this preview." },
  captureOpenInMonitor: { title: "Open in Monitor", description: "Load this session into the full packet monitor for detailed analysis." },
  captureApplyFilter: { title: "Apply filter", description: "Apply the display filter expression to the packet list." },
  captureClearFilter: { title: "Clear filter", description: "Remove the display filter and show all packets." },

  // CaptureViewer tabs
  captureTabPackets: { title: "Packets", description: "Browse the full list of captured packets." },
  captureTabStatistics: { title: "Statistics", description: "Protocol distribution, packet rates, and top talkers." },
  captureTabCallFlows: { title: "Call Flows", description: "SIP call flow ladder diagrams for captured calls." },

  // Monitor sidebar tabs
  captureTabDetails: { title: "Details", description: "Decoded packet details for the selected packet." },
  captureTabStats: { title: "Stats", description: "Live capture statistics — rates, protocols, top IPs." },
  captureTabFlows: { title: "Flows", description: "SIP call flow visualization for captured calls." },
  captureTabRtp: { title: "RTP Streams", description: "Live RTP stream quality — jitter, packet loss, MOS scores, and codec details." },

  // Packet Diff (forensics)
  packetDiffTitle: {
    title: "Compare packets",
    description: "Side-by-side rows from two reconstructed sessions: each row is one frame on A paired with the best match on B (Wireshark-style diff, not a raw byte merge).",
  },
  packetDiffLeftSession: {
    title: "Left capture",
    description: "The packet capture (recording) used as side A in the diff. One capture can hold many reconstructed sessions.",
  },
  packetDiffRightSession: {
    title: "Right capture",
    description: "The packet capture used as side B. Compare the same or a different recording against side A.",
  },
  packetDiffLeftCall: {
    title: "Left session",
    description:
      "A reconstructed VoIP session from the left capture. Use search and quick filters (SIP, RTP, fax, etc.) to narrow the list.",
  },
  packetDiffRightCall: {
    title: "Right session",
    description:
      "A reconstructed session from the right capture. Pick a different trace than side A when both captures are the same file.",
  },
  packetDiffAlignMode: {
    title: "How packets are paired",
    description:
      "Chooses which frame on capture B belongs next to each frame on A. “Same message” compares stable protocol fields (not parser summary text). Timestamp mode scores candidates by protocol, 5-tuple, and time.",
  },
  packetDiffPairingContent: {
    title: "Match by message",
    description:
      "Pairs frames that decode to the “same” SIP/RTP/RTCP/DNS event (same 5-tuple + stable fields). Closest to how Wireshark compares decoded rows — not raw byte-for-byte.",
  },
  packetDiffPairingTime: {
    title: "Match by time",
    description:
      "Pairs each A frame with the closest B frame in time (within your window). Uses protocol and endpoints as tie-breakers. Use when clocks line up but packet order differs.",
  },
  packetDiffPairingIndex: {
    title: "Same row number",
    description: "Row 1 with row 1, row 2 with row 2. Only when both captures are already frame-aligned (same count and order).",
  },
  packetDiffTimestampWindow: { title: "Timestamp window", description: "Maximum millisecond gap allowed when pairing packets in timestamp mode." },
  packetDiffMismatchesOnly: {
    title: "Problems only",
    description: "Hide rows where both sides match exactly — useful once pairing looks correct.",
  },
  packetDiffTrafficFilter: {
    title: "Traffic types",
    description: "Each row is kept if either side has a packet in an enabled category. At least one type must stay on.",
  },
  packetDiffPairingHealth: {
    title: "Pairing sanity check",
    description:
      "Uses every paired row for the current “Pair frames” mode, before you hide protocols or “differences only”. Lots of “only A / only B” usually means try another pairing mode or a wider time window.",
  },
  packetDiffOpenLeftCall: { title: "Open left session", description: "Open the SIP Call-ID for this trace in Packet Viewer." },
  packetDiffOpenRightCall: { title: "Open right session", description: "Open the SIP Call-ID for this trace in Packet Viewer." },
  packetDiffExactCount: { title: "Same decode", description: "Visible rows where both sides decode the same (paired match)." },
  packetDiffChangedCount: { title: "Different", description: "Visible rows where both sides are paired but decoded fields differ." },
  packetDiffLeftOnlyCount: { title: "Only capture A", description: "Visible rows with a frame on A and no paired frame on B." },
  packetDiffRightOnlyCount: { title: "Only capture B", description: "Visible rows with a frame on B and no paired frame on A." },
  packetDiffLaneLeft: { title: "Left lane", description: "Packet rows from the left selected session." },
  packetDiffLaneRight: { title: "Right lane", description: "Packet rows from the right selected session." },
  packetDiffLaneStatus: {
    title: "Match column",
    description: "= same decode, ~ paired but different, − only on A, + only on B. RTP runs may show ≡ when collapsed.",
  },
  packetDiffOpenLeftPacket: { title: "Open left packet", description: "Inspect this left packet in Packet Viewer." },
  packetDiffOpenRightPacket: { title: "Open right packet", description: "Inspect this right packet in Packet Viewer." },
  packetDiffToggleFields: { title: "Unchanged fields", description: "Show all fields or only changed fields for selected row." },
  packetDiffDimExact: {
    title: "Fade matching rows",
    description: "Lowers contrast on same-decode rows so differences and one-sided frames stand out.",
  },
  packetDiffHoverCorrelate: {
    title: "Hover correlate",
    description: "Hover highlights rows that share SIP Call-ID / CSeq transaction keys or RTP/RTCP SSRC across both captures.",
  },
  packetDiffDeltaTime: {
    title: "Gap (inter-arrival)",
    description: "Milliseconds since the previous visible row on that capture. Spikes often flag jitter, blocking, or loss recovery.",
  },
  packetDiffHideTcpAck: {
    title: "Hide idle TCP ACKs",
    description: "Drops exact-match rows that look like pure TCP ACK churn so signaling and media diffs stay visible.",
  },
  packetDiffCollapseRtp: {
    title: "Collapse identical RTP runs",
    description:
      "Folds stretches of 12+ exact-matching RTP/SRTP rows (same SSRC + payload type on both captures) into one banner. Use the chevron to expand a run; Collapse run tucks it back. Any changed or missing row breaks the run so drops stay visible.",
  },

  // Monitor view actions
  captureSidebarToggle: (open: boolean) => ({
    title: open ? "Hide sidebar" : "Show sidebar",
    description: open ? "Collapse the details sidebar to see more packets." : "Expand the sidebar to view packet details, stats, or flows.",
  } as TooltipEntry),

  // Packet list columns
  captureColNumber: { title: "#", description: "Packet sequence number in this capture." },
  captureColTime: { title: "Time", description: "Timestamp when the packet was captured." },
  captureColSource: { title: "Source", description: "Sending IP address and port." },
  captureColDest: { title: "Destination", description: "Receiving IP address and port." },
  captureColProtocol: { title: "Protocol", description: "Detected protocol (SIP, RTP, TCP, UDP, etc.)." },
  captureColLength: { title: "Length", description: "Packet size in bytes." },
  captureColInfo: { title: "Info", description: "Protocol-specific summary or decoded content." },
  captureColSettings: { title: "Column settings", description: "Show, hide, and reorder columns." },
  captureColMoveLeft: { title: "Move left", description: "Move this column one position to the left." },
  captureColMoveRight: { title: "Move right", description: "Move this column one position to the right." },
  captureColSort: (col: string, dir?: string) => ({
    title: `Sort by ${col}`,
    description: dir ? `Currently sorted ${dir}. Click to change.` : "Click to sort by this column.",
  } as TooltipEntry),
  captureWindowPrev: { title: "Previous page", description: "Load the previous window of packets." },
  captureWindowNext: { title: "Next page", description: "Load the next window of packets." },

  // Saved filters
  captureSavedFilterLoad: { title: "Load filter", description: "Apply this saved filter to the current capture." },
  captureSavedFilterDelete: { title: "Delete filter", description: "Permanently remove this saved filter." },

  // Call flow
  captureCallFlowSearch: {
    title: "Search SIP dialogs",
    description: "Filter by SIP Call-ID, From/To URI, method, or status code — covers voice, fax-over-SIP, and other SIP-backed flows.",
  },

  // FilterDialog
  captureFilterTabBasic: { title: "Basic filters", description: "Select which protocols to capture." },
  captureFilterTabAdvanced: { title: "Advanced filters", description: "Fine-tune by IP ranges, ports, and port ranges." },
  captureFilterRemoveEntry: { title: "Remove", description: "Remove this filter entry." },
  captureFilterAddEntry: { title: "Add", description: "Add the entered value as a new filter entry." },
  captureFilterClearRtpRange: { title: "Reset RTP port range", description: "Clear custom RTP port range and use the default (10000–60000)." },
  captureFilterCancel: { title: "Cancel", description: "Discard changes and close the filter dialog." },
  captureFilterSave: { title: "Save filters", description: "Apply these filters to the current or next capture session." },

  // ——— Softphone ———
  softphoneDialer: { title: "Dialer", description: "Keypad and dial controls" },
  softphoneCalls: (n: number) =>
    ({ title: n === 0 ? "Call history" : `${n} call(s)`, description: "View and manage calls" } as TooltipEntry),
  softphoneCollapseDialer: { title: "Collapse dialer", description: "Hide keypad to save space" },
  softphoneCallState: {
    title: "Call state",
    description: "Current call state and last SIP response (e.g. 200 OK)",
  },
  softphoneCodecRtp: {
    title: "Codec & RTP",
    description: "Negotiated codec and local ↔ remote RTP address:port",
  },
  softphoneQuality: {
    title: "Quality",
    description: "MOS 1–4.5 (4.3+ excellent). Jitter in ms; lower is better.",
  },
  softphoneToAnswer: { title: "To answer", description: "Time until remote answered" },
  softphoneTalkTime: { title: "Talk time", description: "Active conversation (not on hold, not muted)" },
  softphoneStarted: { title: "Started", description: "Call start time" },
  softphoneResponse: { title: "Response", description: "Time from INVITE sent until 200 OK received" },
  softphoneEnded: { title: "Ended", description: "Call end time" },
  softphoneTransferredTo: {
    title: "Transferred to",
    description: "Call was transferred by re-INVITE to this target",
  },

  // ——— Notes ———
  notesNewNote: { title: "New note", description: "Create a new note" },
  notesSearch: { title: "Search notes", description: "Search by title and content" },
  notesFolder: (name: string) => ({ title: name, description: "Folder of notes" } as TooltipEntry),
  notesTag: (name: string) => ({ title: name, description: "Tag" } as TooltipEntry),

  // ——— Common ———
  commonRefresh: { title: "Refresh", description: "Reload data" },
  commonExport: { title: "Export", description: "Export data" },
  commonClose: { title: "Close", description: "Close this panel or dialog" },
  commonSave: { title: "Save", description: "Save changes" },
  commonCancel: { title: "Cancel", description: "Discard and close" },
  commonDelete: { title: "Delete", description: "Remove this item" },
  commonEdit: { title: "Edit", description: "Edit this item" },
  commonCopy: { title: "Copy", description: "Copy to clipboard" },
  commonClickForDetails: { title: "Click for details", description: "Open full details" },

  // ═══════════════════════════════════════════════════════════════════════════
  // Educational / Networking Reference Tooltips
  // ═══════════════════════════════════════════════════════════════════════════

  // ——— Protocol Explanations (reusable across all views) ———
  protoTcp: { title: "TCP", description: "Transmission Control Protocol — reliable, ordered, connection-oriented delivery. Uses 3-way handshakes (SYN/ACK) and retransmissions to guarantee delivery." },
  protoUdp: { title: "UDP", description: "User Datagram Protocol — lightweight, connectionless transport. Used for real-time media (RTP), DNS, and SNMP. No delivery guarantee but very low latency." },
  protoSip: { title: "SIP", description: "Session Initiation Protocol — signaling for VoIP calls. INVITE starts a call, BYE ends it, REGISTER announces presence, OPTIONS probes capabilities." },
  protoRtp: { title: "RTP", description: "Real-time Transport Protocol — carries audio/video media streams between endpoints. Typically runs over UDP on high-numbered ports." },
  protoRtcp: { title: "RTCP", description: "RTP Control Protocol — quality feedback sent alongside RTP: jitter, packet loss, round-trip time. Used for adaptive bitrate and quality monitoring." },
  protoDns: { title: "DNS", description: "Domain Name System — translates human-readable hostnames (e.g. example.com) into IP addresses. Uses UDP port 53." },
  protoHttp: { title: "HTTP", description: "Hypertext Transfer Protocol — web and API traffic. Unencrypted, runs on TCP port 80 by default." },
  protoHttps: { title: "HTTPS", description: "HTTP Secure — encrypted web traffic using TLS. Runs on TCP port 443 by default. The payload is not visible in packet captures." },
  protoIcmp: { title: "ICMP", description: "Internet Control Message Protocol — used for ping, traceroute, and network error messages like 'Destination Unreachable'." },
  protoArp: { title: "ARP", description: "Address Resolution Protocol — maps IP addresses to MAC (hardware) addresses on a local network segment. Broadcast-based." },
  protoTls: { title: "TLS", description: "Transport Layer Security — encrypts TCP connections. Powers HTTPS, SRTP, SIPS, and other secure protocols." },
  protoT38: { title: "T.38", description: "Virtual fax — carries fax data in real-time over an IP network using UDPTL for error correction." },
  protoFax: { title: "FAX", description: "Virtual fax protocols — includes T.38 (real-time) and T.30 (traditional) fax signaling and media." },
  protoOther: { title: "Other", description: "Protocols not specifically categorized — includes SCTP, GRE, IGMP, and other less common traffic." },

  // ——— Packet List Column Headers ———
  colNumber: { title: "#", description: "Packet sequence number — the order in which packets were captured." },
  colTime: { title: "Time", description: "Timestamp — when the packet was captured, relative to the capture start or as absolute time." },
  colSource: { title: "Source", description: "Source IP address (and port) — the sender of this packet." },
  colDestination: { title: "Destination", description: "Destination IP address (and port) — the intended receiver of this packet." },
  colProtocol: { title: "Protocol", description: "Network protocol identified — the highest-layer protocol detected (SIP, RTP, DNS, TCP, etc.)." },
  colLength: { title: "Length", description: "Packet size in bytes — total frame length including all headers and payload." },
  colInfo: { title: "Info", description: "Protocol summary — a brief human-readable description of what this packet does." },
  colSrcMac: { title: "Src MAC", description: "Source MAC address — the unique 48-bit hardware identifier of the sending network interface." },
  colDstMac: { title: "Dst MAC", description: "Destination MAC address — the hardware address of the receiving device on the local network segment." },
  colTtl: { title: "TTL", description: "Time To Live — decremented by 1 at each router hop. Prevents packets from circling forever. Typically starts at 64 (Linux) or 128 (Windows)." },
  colTcpFlags: { title: "TCP Flags", description: "TCP control bits — SYN (connect), ACK (acknowledge), FIN (close), RST (reset), PSH (push data immediately), URG (urgent)." },
  colTcpSeq: { title: "TCP Seq", description: "Sequence number — tracks the byte position in the TCP data stream. Used for ordering and reassembly of segments." },
  colTcpAck: { title: "TCP Ack", description: "Acknowledgment number — confirms receipt of all data up to this byte position from the other side." },
  colUdpLen: { title: "UDP Len", description: "UDP datagram length — total size of the UDP header (8 bytes) plus the payload, in bytes." },
  colChecksum: { title: "Checksum", description: "Error-detection value — a computed hash that verifies the packet wasn't corrupted in transit." },

  // ——— IP Layer Fields ———
  fieldIpVersion: { title: "Version", description: "IP version — 4 for IPv4 (most common), 6 for IPv6." },
  fieldIpHeaderLen: { title: "Header Length", description: "IP header size in bytes — typically 20 bytes for IPv4 without options." },
  fieldIpTotalLen: { title: "Total Length", description: "Total IP packet size — header plus payload, in bytes." },
  fieldIpTtl: { title: "TTL", description: "Time To Live — hop limit that prevents packets from looping forever. Decremented by 1 at each router." },
  fieldIpProtocol: { title: "Protocol", description: "Transport protocol number — 6 = TCP, 17 = UDP, 1 = ICMP, 2 = IGMP." },
  fieldIpChecksum: { title: "Checksum", description: "Header checksum — verifies IP header integrity. Recalculated at every router hop (because TTL changes)." },

  // ——— TCP Fields ———
  fieldTcpSrcPort: { title: "Source Port", description: "TCP source port — identifies the sending application. Ephemeral ports (1024–65535) are typically used by clients." },
  fieldTcpDstPort: { title: "Destination Port", description: "TCP destination port — identifies the receiving service (e.g. 80=HTTP, 443=HTTPS, 5060=SIP)." },
  fieldTcpSeq: { title: "Sequence Number", description: "Byte-stream position of the first byte in this segment. Used for ordering and reassembly." },
  fieldTcpAck: { title: "Acknowledgment", description: "Next expected byte from the other side — confirms all prior data was received." },
  fieldTcpWindowSize: { title: "Window Size", description: "Flow control — how many bytes the receiver is willing to accept before requiring an acknowledgment." },
  fieldTcpChecksum: { title: "Checksum", description: "TCP checksum — covers the header, payload, and a pseudo-header for integrity verification." },
  fieldTcpFlags: { title: "TCP Flags", description: "Control bits that manage the TCP connection lifecycle and data flow." },
  fieldTcpFlagSyn: { title: "SYN", description: "Synchronize — initiates a TCP connection. Part of the 3-way handshake: SYN → SYN-ACK → ACK." },
  fieldTcpFlagAck: { title: "ACK", description: "Acknowledge — confirms receipt of data or a connection request. Present in most TCP segments." },
  fieldTcpFlagFin: { title: "FIN", description: "Finish — gracefully closes one direction of a TCP connection." },
  fieldTcpFlagRst: { title: "RST", description: "Reset — abruptly terminates a connection. Often indicates an error, refused connection, or firewall rejection." },
  fieldTcpFlagPsh: { title: "PSH", description: "Push — tells the receiver to deliver buffered data to the application immediately." },
  fieldTcpFlagUrg: { title: "URG", description: "Urgent — marks data as high-priority. Rarely used in modern networks." },

  // ——— UDP Fields ———
  fieldUdpSrcPort: { title: "Source Port", description: "UDP source port — identifies the sending application. Often ephemeral for clients." },
  fieldUdpDstPort: { title: "Destination Port", description: "UDP destination port — identifies the service (e.g. 53=DNS, 5060=SIP, 10000+=RTP)." },
  fieldUdpLength: { title: "Length", description: "Total UDP datagram size — 8-byte header plus the payload." },
  fieldUdpChecksum: { title: "Checksum", description: "UDP checksum — optional in IPv4, mandatory in IPv6. Verifies datagram integrity." },

  // ——— SIP Fields ———
  fieldSipMethod: { title: "Method", description: "SIP request type — INVITE (start call), BYE (end call), REGISTER (announce presence), OPTIONS (probe capabilities), ACK (confirm), CANCEL (abort)." },
  fieldSipResponseCode: { title: "Response Code", description: "3-digit SIP status: 1xx provisional (100 Trying, 180 Ringing), 2xx success (200 OK), 3xx redirect, 4xx client error (401, 403, 404), 5xx server error, 6xx global failure." },
  fieldSipStatus: { title: "Status", description: "Response status text — human-readable reason phrase accompanying the numeric response code." },
  fieldSipFrom: { title: "From", description: "SIP From header — identifies the call originator (caller URI and display name)." },
  fieldSipTo: { title: "To", description: "SIP To header — identifies the call recipient (callee URI and display name)." },
  fieldSipCallId: { title: "Call-ID", description: "Unique identifier for the entire SIP dialog — stays the same across all messages in one call." },
  fieldSipCseq: { title: "CSeq", description: "Command Sequence — pairs a sequence number with a method name to match requests with responses." },

  // ——— RTP Fields ———
  fieldRtpVersion: { title: "Version", description: "RTP version — always 2 for current implementations." },
  fieldRtpPayloadType: { title: "Payload Type", description: "Codec identifier — 0 = G.711 μ-law, 8 = G.711 A-law, 9 = G.722, 18 = G.729, 96–127 = dynamic (e.g. H.264)." },
  fieldRtpSeqNum: { title: "Sequence Number", description: "Increments by 1 per packet — used to detect loss and reorder packets at the receiver." },
  fieldRtpTimestamp: { title: "Timestamp", description: "Media clock timestamp — reflects the sampling instant of the first byte. Used for synchronization and jitter calculation." },
  fieldRtpSsrc: { title: "SSRC", description: "Synchronization Source — a random 32-bit identifier for this particular media stream. Unique per sender." },

  // ——— RTCP Fields ———
  fieldRtcpType: { title: "RTCP Type", description: "Report type — SR (Sender Report), RR (Receiver Report), SDES (Source Description), BYE (Goodbye), APP (Application-specific)." },
  fieldRtcpSr: { title: "Sender Report (SR)", description: "Sent by active media senders — contains NTP timestamp, RTP timestamp, packet count, and byte count." },
  fieldRtcpRr: { title: "Receiver Report (RR)", description: "Sent by receivers — contains loss fraction, cumulative loss, jitter, and last sequence number received." },
  fieldRtcpSdes: { title: "Source Description (SDES)", description: "Identifies the sender with CNAME (canonical name), email, phone, or other descriptors." },
  fieldRtcpBye: { title: "Goodbye (BYE)", description: "Indicates a source is leaving the session — used for graceful stream teardown." },
  fieldRtcpSsrc: { title: "SSRC", description: "Synchronization Source identifier — matches this report to a specific RTP stream." },
  fieldRtcpPacketsSent: { title: "Packets Sent", description: "Total RTP packets transmitted by this sender since the start of the session." },
  fieldRtcpBytesSent: { title: "Bytes Sent", description: "Total RTP payload bytes transmitted (excludes headers)." },
  fieldRtcpRtpTimestamp: { title: "RTP Timestamp", description: "RTP media clock value corresponding to the NTP timestamp in this Sender Report." },
  fieldRtcpSourceSsrc: { title: "Source SSRC", description: "SSRC of the RTP stream being reported on by this Receiver Report." },
  fieldRtcpFractionLost: { title: "Fraction Lost", description: "Packet loss since last report — 0 = no loss, 255 = 100% loss. Multiply by 100/256 for percentage." },
  fieldRtcpCumulativeLost: { title: "Cumulative Lost", description: "Total packets lost since the start of the session for this SSRC." },
  fieldRtcpJitter: { title: "Jitter", description: "Inter-arrival time variation in timestamp units. High jitter (>30ms) can cause audio artefacts or dropouts." },
  fieldRtcpHighestSeq: { title: "Highest Seq", description: "Highest RTP sequence number received — used with cumulative loss to calculate overall loss rate." },
  fieldRtcpSdesItems: { title: "SDES Items", description: "Source description items — CNAME (canonical name) is mandatory; may also include NAME, EMAIL, PHONE, LOC." },

  // ——— DNS Fields ———
  fieldDnsType: { title: "Type", description: "DNS message type — Query (request) or Response (answer)." },
  fieldDnsTransactionId: { title: "Transaction ID", description: "16-bit identifier that matches DNS queries to their responses." },
  fieldDnsResponseCode: { title: "Response Code", description: "DNS status: 0 = No Error, 1 = Format Error, 2 = Server Failure, 3 = NXDOMAIN (name doesn't exist), 5 = Refused." },
  fieldDnsQuestion: { title: "Question", description: "The domain name being queried and the record type requested (A, AAAA, MX, etc.)." },
  fieldDnsAnswer: { title: "Answer", description: "DNS response records — the resolved IP addresses, mail servers, or other data for the queried name." },
  fieldDnsTtl: { title: "TTL", description: "DNS record Time To Live — how many seconds this answer can be cached before re-querying." },
  dnsTypeA: { title: "A Record", description: "Maps a hostname to an IPv4 address (e.g. example.com → 93.184.216.34)." },
  dnsTypeAAAA: { title: "AAAA Record", description: "Maps a hostname to an IPv6 address." },
  dnsTypeNs: { title: "NS Record", description: "Name Server — identifies the authoritative DNS servers for a domain." },
  dnsTypeCname: { title: "CNAME Record", description: "Canonical Name — an alias that points one hostname to another." },
  dnsTypeMx: { title: "MX Record", description: "Mail Exchange — specifies the mail server(s) responsible for receiving email for the domain." },
  dnsTypeTxt: { title: "TXT Record", description: "Text record — holds arbitrary text. Used for SPF, DKIM, domain verification, and more." },
  dnsTypeSrv: { title: "SRV Record", description: "Service record — locates servers for specific services (e.g. _sip._udp for SIP)." },
  dnsTypePtr: { title: "PTR Record", description: "Pointer record — maps an IP address back to a hostname (reverse DNS)." },
  dnsTypeSoa: { title: "SOA Record", description: "Start of Authority — zone metadata including primary nameserver, admin email, and refresh timers." },
  dnsTypeNaptr: { title: "NAPTR Record", description: "Naming Authority Pointer — used in ENUM and SIP to map phone numbers to SIP URIs." },

  // ——— T.38 / UDPTL Fields ———
  fieldT38UdptlType: { title: "UDPTL Type", description: "UDPTL packet type — the transport layer used by T.38 for fax-over-IP with error correction." },
  fieldT38Sequence: { title: "Sequence", description: "UDPTL sequence number — used to detect lost fax packets and trigger retransmission." },
  fieldT38PrimaryLen: { title: "Primary Length", description: "Size of the primary IFP (Internet Facsimile Protocol) data payload in bytes." },
  fieldT38IfpType: { title: "IFP Type", description: "Internet Facsimile Protocol data type — identifies the fax signal (T.30 indicator, data, or training)." },

  // ——— Statistics Labels ———
  statTotalPackets: { title: "Total Packets", description: "Total number of packets captured or loaded in this session." },
  statTotalBytes: { title: "Total Bytes", description: "Total data volume captured — sum of all packet sizes including headers." },
  statPacketsPerSec: { title: "Packets/sec", description: "Packet rate — average number of packets captured per second. Higher rates mean busier traffic." },
  statBandwidth: { title: "Bandwidth", description: "Network throughput — data rate in bits per second (Kbps/Mbps). Measures actual traffic volume." },
  statProtocolBreakdown: { title: "Protocol Breakdown", description: "Distribution of captured packets by protocol type — shows which protocols dominate the traffic." },
  statTopSourceIps: { title: "Top Source IPs", description: "IP addresses that sent the most packets — helps identify the busiest senders." },
  statTopDestIps: { title: "Top Destination IPs", description: "IP addresses that received the most packets — helps identify the busiest receivers." },
  statInterface: { title: "Interface", description: "Network interface — the physical or virtual adapter used for packet capture (e.g. en0, eth0, lo0)." },
  statPcapFile: { title: "PCAP File", description: "Packet capture file path — the saved .pcap file containing the raw captured packets." },

  // ——— Pipeline Performance ———
  statPipelineCaptured: { title: "Captured", description: "Packets captured by the network adapter — raw count before any parsing or filtering." },
  statPipelineParsed: { title: "Parsed", description: "Packets successfully parsed — decoded into protocol-specific structures for display." },
  statPipelineRawQueue: { title: "Raw Queue", description: "Packets waiting to be parsed — a high count means the parser can't keep up with capture rate." },
  statPipelineParsedQueue: { title: "Parsed Queue", description: "Parsed packets waiting for the UI — a high count means the display is falling behind." },
  statPipelineDropCapture: { title: "Dropped (capture)", description: "Packets lost at capture — the network adapter couldn't keep up. May indicate high traffic or CPU load." },
  statPipelineDropParser: { title: "Dropped (parser)", description: "Packets lost at parse — the parser queue overflowed. Consider simplifying filters or increasing buffer size." },

  // ——— Filter Dialog Terms ———
  filterCidr: { title: "CIDR Notation", description: "Classless Inter-Domain Routing — e.g. 192.168.1.0/24 matches 256 addresses (192.168.1.0–255). /32 = single host, /16 = 65536 addresses." },
  filterBpf: { title: "BPF Filter", description: "Berkeley Packet Filter — standard tcpdump/Wireshark capture filter syntax. Applied at capture time for efficient packet matching." },
  filterPortRange: { title: "Port Range", description: "Filter packets within a port number range — e.g. 10000–20000 is common for RTP media streams." },
  filterSrcPorts: { title: "Source Ports", description: "Filter by the sending application's port number — comma-separated (e.g. 5060, 5061)." },
  filterDstPorts: { title: "Destination Ports", description: "Filter by the receiving service's port number — comma-separated (e.g. 5060, 5061)." },
  filterSrcIpRange: { title: "Source IP Ranges", description: "Filter by sender IP address — use CIDR notation for subnets or plain IPs separated by commas." },
  filterDstIpRange: { title: "Destination IP Ranges", description: "Filter by receiver IP address — use CIDR notation for subnets or plain IPs separated by commas." },
  filterPacketLimit: { title: "Packet Limit", description: "Stop the capture automatically after this many packets have been collected." },
  filterDuration: { title: "Duration", description: "Stop the capture automatically after this many seconds have elapsed." },

  // ——— SIP Method Badges ———
  sipMethodInvite: { title: "INVITE", description: "Initiates a new call or session — the first message in a SIP call setup." },
  sipMethodBye: { title: "BYE", description: "Terminates an established call — sent by whichever party hangs up." },
  sipMethodAck: { title: "ACK", description: "Acknowledges a final response to INVITE — completes the 3-way handshake for call setup." },
  sipMethodCancel: { title: "CANCEL", description: "Cancels a pending INVITE — used when the caller hangs up before the call is answered." },
  sipMethodRegister: { title: "REGISTER", description: "Registers a user's contact address with a SIP registrar — enables incoming calls to be routed." },
  sipMethodOptions: { title: "OPTIONS", description: "Queries the capabilities of a SIP endpoint — often used as a keep-alive or health check." },
  sipMethodRefer: { title: "REFER", description: "Requests call transfer — tells the other party to contact a third-party URI." },
  sipMethodNotify: { title: "NOTIFY", description: "Delivers event notifications within a subscription — e.g. voicemail waiting, presence status." },
  sipMethodSubscribe: { title: "SUBSCRIBE", description: "Subscribes to event notifications — e.g. BLF (busy lamp field), message waiting." },
  sipMethodInfo: { title: "INFO", description: "Carries mid-dialog information — often used for DTMF tones or call statistics." },
  sipMethodUpdate: { title: "UPDATE", description: "Modifies a session before it's fully established — updates codec or media parameters." },
  sipMethodPrack: { title: "PRACK", description: "Provisional Response ACK — acknowledges a reliable provisional response (e.g. 183 Session Progress)." },

  // ——— SIP Response Code Ranges ———
  sipResponse1xx: { title: "1xx Provisional", description: "Informational — request received, continuing to process. 100 Trying, 180 Ringing, 183 Session Progress." },
  sipResponse2xx: { title: "2xx Success", description: "Request succeeded — 200 OK (call answered or registration accepted), 202 Accepted." },
  sipResponse3xx: { title: "3xx Redirect", description: "The user has moved — try an alternative URI. 301 Moved Permanently, 302 Moved Temporarily." },
  sipResponse4xx: { title: "4xx Client Error", description: "Request failed — 401 Unauthorized, 403 Forbidden, 404 Not Found, 408 Request Timeout, 486 Busy Here." },
  sipResponse5xx: { title: "5xx Server Error", description: "Server failed — 500 Internal Error, 502 Bad Gateway, 503 Service Unavailable." },
  sipResponse6xx: { title: "6xx Global Failure", description: "Request cannot be fulfilled anywhere — 600 Busy Everywhere, 603 Decline." },

  // ——— Network Test: Speed & Throughput ———
  netSpeedInternetSection: {
    title: "Internet Speed (HTTP)",
    description: "Measures internet download and upload throughput over HTTP(S) against the currently selected speed source preset (Cloudflare or LibreSpeed endpoint). Reflects real-world ISP path performance including protocol overhead and routing.",
  },
  netSpeedDownload: {
    title: "Download (HTTP)",
    description: "Inbound internet throughput from the selected speed source. Represents practical receive performance for streaming, browsing, and file downloads.",
  },
  netSpeedUpload: {
    title: "Upload (HTTP)",
    description: "Outbound internet throughput to the selected speed source. Represents practical send performance for video calls, uploads, and backups.",
  },
  netSpeedLatency: {
    title: "Latency",
    description: "Round-trip latency measured during the internet speed test path. Lower is better — high values indicate delay on the route to the selected source.",
  },
  netSpeedJitter: {
    title: "Jitter (HTTP)",
    description: "Variation in latency during the internet speed test. Higher jitter can degrade real-time audio/video quality even when average latency looks acceptable.",
  },
  netBandwidthSection: {
    title: "UDP Throughput (Local)",
    description: "Measures raw UDP throughput using a local loopback path on the current execution target (this device or remote agent). This isolates host stack and processing capacity from ISP/internet path effects.",
  },
  netBandwidthDownload: {
    title: "Download (UDP)",
    description: "Inbound UDP throughput for the local loopback test path. Indicates receive-side capacity for real-time UDP traffic processing.",
  },
  netBandwidthUpload: {
    title: "Upload (UDP)",
    description: "Outbound UDP throughput for the local loopback test path. Indicates send-side capacity for real-time UDP traffic processing.",
  },
  netBandwidthBytes: {
    title: "Total Bytes Transferred",
    description: "Combined sent and received data during the UDP throughput test. Larger transfers give more accurate throughput measurements.",
  },
  netBandwidthDuration: {
    title: "Test Duration",
    description: "Actual time elapsed for the UDP throughput test. Longer tests smooth out bursts and give more representative averages.",
  },
  netSpeedVsBandwidth: {
    title: "Why are these different?",
    description: "Internet Speed measures external ISP path performance (HTTP/TCP) to the selected public endpoint. UDP Throughput measures local UDP processing capacity on the current execution target. Differences are expected because they measure different paths and protocol stacks.",
  },

  // ——— Network Test: Port Scan ———
  netPortStatusOpen: {
    title: "Open (Confirmed)",
    description: "The port responded to our probe — the service is definitively reachable and listening. A response was received within the timeout window.",
  },
  netPortStatusOpenFiltered: {
    title: "Open | Filtered (UDP)",
    description: "No response was received, but no ICMP 'port unreachable' error was returned either. This is normal for UDP — most services (SIP, RTP, STUN) silently ignore unrecognised packets. For VoIP this is typically a pass and means the port is likely open.",
  },
  netPortStatusClosed: {
    title: "Closed",
    description: "The port actively refused the connection (TCP RST or ICMP 'port unreachable'). No service is listening on this port — traffic will not reach an application.",
  },
  netPortStatusFiltered: {
    title: "Filtered",
    description: "No response at all — the probe was silently dropped, likely by a firewall or ACL. The port may be open behind the filter but is unreachable from your network path.",
  },

  // ——— Context Menu Filter Terms ———
  filterConversation: { title: "Conversation", description: "Show all packets between these two IP addresses — both directions." },
  filterTcpStream: { title: "TCP Stream", description: "Show all packets in this TCP connection — matched by source/destination IP and port pairs." },
  filterUdpStream: { title: "UDP Stream", description: "Show all packets in this UDP flow — matched by source/destination IP and port pairs." },
  filterByProtocol: { title: "Filter by Protocol", description: "Show only packets of this protocol type." },
  filterBySipCallId: { title: "SIP Call-ID", description: "Show all SIP messages belonging to this call — matched by the unique Call-ID header." },
  filterBySipFrom: { title: "SIP From", description: "Show all SIP messages from this caller URI." },
  filterBySipTo: { title: "SIP To", description: "Show all SIP messages to this callee URI." },
  // ——— Request Builder (Crafter) ———
  crafterSipMethod: {
    title: "SIP Method",
    description: "The SIP request method. OPTIONS for reachability ping, REGISTER for registration, INVITE for calls.",
  },
  crafterSipTransport: {
    title: "Transport",
    description: "UDP is default and fast. TCP for reliable or large messages. TLS for encrypted signaling (port 5061).",
  },
  crafterSipUri: {
    title: "Request-URI",
    description: "Format: sip:user@host:port. The host portion is extracted for target routing.",
  },
  crafterHttpMethod: {
    title: "HTTP Method",
    description: "GET to read, POST to create, PUT to replace, PATCH to update, DELETE to remove.",
  },
  crafterHttpUrl: {
    title: "Request URL",
    description: "Full URL including scheme (https://). Query params can also be added in the Params tab.",
  },
  crafterAutoFillHeaders: {
    title: "Auto-fill Headers",
    description: "Generate required SIP headers: Via, From, To, Call-ID, CSeq, Max-Forwards, Contact, User-Agent.",
  },
  crafterSipAuth: {
    title: "Digest Authentication",
    description: "SIPalyzer auto-retries with digest credentials on 401/407. Add username and password here.",
  },
  crafterHttpAuth: {
    title: "HTTP Authentication",
    description: "Basic sends base64-encoded credentials. Bearer sends an OAuth2/JWT token. Custom sends any header.",
  },
  crafterSendButton: {
    title: "Send Request",
    description: "Send the request and show the response below. History is saved automatically.",
  },

  // ——— Interface Selection ———
  ifaceNetworkInterface: { title: "Network Interface", description: "The physical or virtual network adapter used for packet capture. Select the interface whose IP matches your local address." },
  ifaceRecommended: { title: "Recommended", description: "Auto-detected primary interface — most likely the correct one for capturing your network traffic." },
  ifaceLoopback: { title: "Loopback", description: "Loopback interface (localhost) — only captures traffic between local processes. Use for testing local services." },
  ifaceVirtual: { title: "Virtual", description: "Virtual interface — typically used by containers, VMs, or bridge networks." },
  ifaceVpn: { title: "VPN", description: "VPN interface — captures traffic routed through a VPN tunnel. Select if your target traffic uses the VPN." },
  ifaceLocalIp: { title: "Local IP Match", description: "This interface has your local IP address — it's likely the correct interface to capture your outbound traffic." },

  // ——— Filter Bar ———
  filterMatchCount: { title: "Matched Packets", description: "Number of packets that match the current display filter." },
  filterValid: { title: "Filter Valid", description: "The display filter syntax is valid and being applied." },
  filterClear: { title: "Clear Filter", description: "Remove the current display filter to show all packets." },

  // ——— Performance Bar ———
  perfPacketCount: { title: "Total Packets", description: "Total number of packets captured or loaded in this session." },

  // ——— Tools: Syslog Receiver ———
  syslogPort: { title: "Syslog UDP Port", description: "UDP port to listen on for incoming syslog messages. Standard syslog uses port 514 — this may require elevated privileges on the remote agent. Use a high port (e.g. 5514) if 514 is unavailable." },
  syslogStart: { title: "Start Listening", description: "Begin receiving syslog messages on the specified UDP port. The agent will bind to this port and stream any incoming RFC 3164/5424 messages in real-time." },
  syslogStop: { title: "Stop Listening", description: "Stop the syslog receiver. The agent will release the UDP port and no further messages will be captured." },
  syslogPause: { title: "Pause / Resume", description: "Temporarily pause the live message feed without stopping the receiver. Messages are still captured — they just won't scroll the display until you resume." },
  syslogSeverity: { title: "Severity Filter", description: "Filter messages by syslog severity level. Severity follows RFC 5424: Emergency (0) is most critical, Debug (7) is most verbose." },
  syslogExport: { title: "Export Messages", description: "Download all captured syslog messages (respecting current filters) as a tab-separated text file." },
  syslogClear: { title: "Clear Messages", description: "Remove all captured messages from the display. This does not stop the receiver." },
  syslogAutoScroll: { title: "Auto-scroll", description: "When enabled, the message list automatically scrolls to show the newest messages as they arrive." },
  syslogStats: { title: "Statistics Dashboard", description: "Toggle the real-time statistics panel showing message rate, unique sources, and severity breakdown." },

  // ——— Tools: Log Viewer ———
  logPresets: { title: "Log File Presets", description: "Common log file paths organized by category — PBX systems (Asterisk, FreePBX, FreeSWITCH), system logs (syslog, auth, kernel), network services, and web servers." },
  logFilter: { title: "Regex Filter", description: "Server-side regex filter applied when fetching or tailing. Only lines matching this pattern will be returned. Uses Go/Rust regex syntax." },
  logTailLines: { title: "Tail Lines", description: "Number of lines to read from the end of the file. Larger values take more memory and time to transfer. Default is 500." },
  logFetchMode: { title: "Fetch Mode", description: "Fetch reads a snapshot of the file (last N lines with optional filter). Best for reviewing existing logs." },
  logTailMode: { title: "Tail Mode", description: "Tail streams new lines as they're written to the file, similar to 'tail -f'. Requires a remote agent — not available locally." },
  logSearch: { title: "Find in Log", description: "Client-side text search that highlights matching lines in the current view. Does not re-fetch from the server." },
  logJumpLine: { title: "Jump to Line", description: "Scroll to and briefly highlight a specific line number in the current log view." },
  logWordWrap: { title: "Word Wrap", description: "When enabled, long lines wrap to fit the viewport. When disabled, lines extend horizontally with a scrollbar." },
  logLineNumbers: { title: "Line Numbers", description: "Show or hide the line number gutter on the left side of the log view." },
  logExport: { title: "Download Log", description: "Download the currently displayed log content as a text file." },

  // ——— Tools: File Server ———
  fileExplorer: { title: "File Explorer", description: "Browse the filesystem on this device or a remote agent. Navigate directories, view file sizes and permissions, and select a directory to serve." },
  fileServerPanel: { title: "HTTP / TFTP Server", description: "Start an HTTP and/or TFTP server to serve files from a directory. Ideal for phone provisioning, firmware upgrades, and configuration deployment." },
  fileRequests: { title: "Request Log", description: "Live feed of all file requests handled by the server, showing client IPs, files accessed, status codes, and transfer sizes." },
  fileServePath: { title: "Serve Directory", description: "The filesystem path on the remote agent that will be served. All files and subdirectories within this path will be accessible via the configured protocols." },
  fileHttpPort: { title: "HTTP Port", description: "The TCP port for the HTTP file server. Default is 8080 to avoid conflicts with existing web servers on port 80." },
  fileProtocol: { title: "Protocol", description: "HTTP serves files over standard web protocol (any browser can access). TFTP is used by IP phones, network devices, and PXE boot for provisioning and firmware updates. 'Both' starts both servers simultaneously." },
  fileHidden: { title: "Hidden Files", description: "Show or hide files and directories that start with a dot (e.g. .bashrc, .ssh). These are hidden by default on Unix systems." },
  fileServeBtn: { title: "Serve Directory", description: "Start serving the current directory. Switch to the Server tab to configure protocols and ports before starting." },
  fileQuickJump: { title: "Quick Navigation", description: "Jump to common directories used for provisioning, logs, configuration, and web content." },
  fileVirtualPanel: { title: "Virtual Server", description: "Drag and drop files to serve them over HTTP without filesystem access. Ideal for quick file sharing, provisioning, and firmware deployment." },
  fileVirtualDropZone: { title: "Drop Zone", description: "Drag files from your computer into this area, or click Browse to select files. All dropped files will be served when the server is started." },
  fileVirtualServeBtn: { title: "Start Virtual Server", description: "Begin serving all added files over HTTP. Files are held in memory — no host filesystem access required." },
  // ——— Tools: Password Generator ———
  passwordGenPanel: { title: "Password Generator", description: "Generate cryptographically secure passwords, keys, and secrets tailored to VoIP and telecom use cases. Select a preset or configure a custom charset." },
  passwordHistory: { title: "Password History", description: "Session-only history of generated passwords for quick re-access. Never persisted to disk — cleared when you leave the view." },
  passwordGenerate: { title: "Generate", description: "Create a new secure password using the current preset and rule configuration." },
  passwordOutput: { title: "Generated Password", description: "Latest generated value. Click the field to select all characters for quick copy." },
  passwordCopyCurrent: { title: "Copy Password", description: "Copy the generated password to your clipboard." },
  passwordClearCurrent: { title: "Clear Password", description: "Clear the current generated password from the field." },
  passwordPreset: { title: "Preset", description: "Choose a profile with secure defaults for common use cases like SIP auth, API tokens, and keys." },
  passwordLength: { title: "Length", description: "Set the number of characters to generate. Longer passwords have higher entropy." },
  passwordCharsetSize: { title: "Charset Size", description: "How many unique characters are available to the generator based on active rules." },
  passwordEntropy: { title: "Entropy", description: "Estimated password strength in bits based on charset size and length." },
  passwordStrength: { title: "Strength Meter", description: "Visual estimate of password strength and crack resistance for the current output." },
  passwordUppercase: { title: "Uppercase", description: "Include uppercase letters A-Z in generated passwords." },
  passwordLowercase: { title: "Lowercase", description: "Include lowercase letters a-z in generated passwords." },
  passwordDigits: { title: "Digits", description: "Include numbers 0-9 in generated passwords." },
  passwordSymbols: { title: "Symbols", description: "Include special characters such as !, @, #, and other punctuation symbols." },
  passwordExcludeAmbiguous: { title: "Exclude Ambiguous", description: "Avoid similar-looking characters like 0/O and 1/l/I to reduce typing mistakes." },

  // ——— Network Test: Shared Components ———
  netRunTest: { title: "Run Test", description: "Execute this network test against the target host." },
  netStopTest: { title: "Stop Test", description: "Cancel the currently running test." },
  netExpandDetails: { title: "Expand Details", description: "Show detailed results and configuration for this test." },
  netCollapseDetails: { title: "Collapse", description: "Hide detailed results and show only the summary." },
  netRunAll: { title: "Run All", description: "Run all tests in this group simultaneously against the target." },
  netTestEverything: { title: "Test Everything", description: "Run every network test against the target in sequence — connectivity, latency, throughput, DNS, and routing." },
  netTargetHost: { title: "Target Host", description: "IP address or hostname to test against. All tests in this suite will use this destination." },

  // ——— Network Test: Ping ———
  netPingProbeCount: { title: "Probe Count", description: "Number of ICMP echo requests to send. More probes give a better statistical average." },
  netPingAvg: { title: "Average Latency", description: "Mean round-trip time across all probes — the most common measure of network responsiveness." },
  netPingMin: { title: "Minimum Latency", description: "Fastest round-trip time observed — represents best-case network performance." },
  netPingMax: { title: "Maximum Latency", description: "Slowest round-trip time observed — high values indicate congestion or routing issues." },
  netPingLoss: { title: "Packet Loss", description: "Percentage of probes that didn't return. Any loss above 0% can degrade VoIP call quality." },
  netPingStdDev: { title: "Standard Deviation", description: "Variation in latency — high values indicate inconsistent network performance (jitter)." },
  netPingMtu: { title: "Include MTU Discovery", description: "Also discover the maximum packet size (MTU) along the path to the target." },

  // ——— Network Test: Traceroute ———
  netTraceHop: { title: "Hop", description: "Sequence number of this router in the path — hop 1 is your gateway, the last hop is the destination." },
  netTraceHost: { title: "Host", description: "IP address or hostname of the router at this hop." },
  netTraceAvgRtt: { title: "Avg RTT", description: "Average round-trip time to this hop across all probes." },
  netTraceProbes: { title: "Probes", description: "Individual probe latencies to this hop — shown as colored bars." },

  // ——— Network Test: Monitor ———
  netMonitorTarget: { title: "Monitor Target", description: "Host to continuously monitor for latency and jitter over time." },
  netMonitorDuration: { title: "Duration (seconds)", description: "How long to run the monitoring session." },
  netMonitorInterval: { title: "Interval (ms)", description: "Time between probe packets. Lower values give finer resolution but more traffic." },
  netMonitorLive: { title: "Live Monitoring", description: "Monitor is actively collecting latency and jitter samples in real-time." },

  // ——— Network Test: MTR ———
  netMtrLoss: { title: "Loss %", description: "Percentage of packets lost at this hop — identifies where packets are being dropped." },
  netMtrSent: { title: "Sent", description: "Total number of probes sent to this hop." },
  netMtrRecv: { title: "Received", description: "Number of probes that returned from this hop." },
  netMtrBest: { title: "Best", description: "Lowest latency observed at this hop." },
  netMtrAvg: { title: "Average", description: "Mean latency at this hop across all probes." },
  netMtrWorst: { title: "Worst", description: "Highest latency observed at this hop — spikes indicate congestion." },
  netMtrStdDev: { title: "Std Dev", description: "Latency variation at this hop — high values indicate jitter." },
  netMtrJitter: { title: "Jitter", description: "Variation in inter-packet delay at this hop — critical for real-time media quality." },

  // ——— Network Test: NTP ———
  netNtpServer: { title: "Server", description: "NTP server hostname or IP being queried for time synchronization." },
  netNtpStratum: { title: "Stratum", description: "Distance from the reference clock — stratum 1 is directly connected to an atomic clock, stratum 2+ are progressively further." },
  netNtpOffset: { title: "Offset", description: "Difference between your system clock and the NTP server. Positive = your clock is ahead, negative = behind." },
  netNtpDelay: { title: "Delay", description: "Network round-trip time to the NTP server — affects accuracy of time synchronization." },
  netNtpStatus: { title: "Clock Status", description: "Overall assessment of your system clock accuracy. OK means within acceptable range for most applications." },

  // ——— Network Test: NAT/ALG ———
  netNatType: { title: "NAT Type", description: "Your NAT classification determines VoIP compatibility. Full Cone is best, Symmetric is most restrictive and may cause call failures." },
  netAlgDetected: { title: "ALG Detected", description: "Application Layer Gateway (ALG) modifies SIP packets in transit — often causes registration failures, one-way audio, and dropped calls. Disabling ALG on your router is usually recommended." },

  // ——— Network Test: SNMP ———
  netSnmpSysName: { title: "System Name", description: "SNMP sysName — the administratively assigned hostname of the network device." },
  netSnmpUptime: { title: "Uptime", description: "How long the device has been running since its last reboot." },
  netSnmpIfStatus: { title: "Interface Status", description: "Operational status of this network interface — Up means actively passing traffic." },
  netSnmpInOctets: { title: "In Octets", description: "Total bytes received on this interface since last counter reset." },
  netSnmpOutOctets: { title: "Out Octets", description: "Total bytes transmitted on this interface since last counter reset." },
  netSnmpErrors: { title: "Errors", description: "Input/output error count — non-zero values may indicate cable, duplex, or hardware issues." },

  // ——— Network Test: Multicast ———
  netMcastGroup: { title: "Multicast Group", description: "Multicast group address in the range 224.0.0.0–239.255.255.255. Standard paging groups often use 239.x.x.x." },
  netMcastPort: { title: "Port", description: "UDP port for the multicast stream. Common values: 5004 (RTP default), 4000-4999 (paging)." },
  netMcastCodec: { title: "Codec", description: "Audio encoding format — PCMU (G.711 μ-law) is the most compatible, G722 offers wideband quality." },
  netMcastTtl: { title: "TTL", description: "Time to Live — maximum number of network hops before multicast packets are discarded. Higher values reach more network segments." },

  // ——— Network Test: Environment Strip ———
  netEnvInternet: { title: "Internet Connectivity", description: "Whether the internet is reachable via health check probes to known reliable endpoints." },
  netEnvWifi: { title: "Wi-Fi Connection", description: "Current Wi-Fi network SSID, signal strength, and channel information." },
  netEnvLocal: { title: "Local Network", description: "Your local IP address, default gateway, and active network interface." },
  netEnvPublic: { title: "Public IP", description: "Your public-facing IP address as detected by STUN — this is how the internet sees your traffic." },

  // ——— Network Test: MOS Score ———
  netMosScore: { title: "MOS Score", description: "Mean Opinion Score — industry standard voice quality rating from 1.0 to 5.0. 4.0+ = Excellent, 3.6+ = Good, 2.5+ = Fair, below 2.5 = Poor." },

  // ——— Network Test: Source Badge ———
  netSourceLocal: { title: "This Device", description: "Result executed directly on this device — reflects your local network path." },
  netSourceAgent: (name: string) => ({ title: `Remote Agent: ${name}`, description: "Result executed on a remote agent — reflects that agent's network path, which may differ from your local network." }),
  // ——— Network Test: Interface Picker ———
  netIfacePicker: { title: "Network Interface", description: "Select which network interface to use for this test. Different interfaces may have different routes and performance characteristics." },
  netIfaceRefresh: { title: "Refresh Interfaces", description: "Re-scan available network interfaces." },
  netIfaceDefault: { title: "Default", description: "System default network interface — used when no specific interface is selected." },
  netIfaceLocal: { title: "Local IP", description: "This interface has your detected local IP address." },

  // ——— Registration: Status & Health ———
  regStatusDot: (status: string) => ({ title: status.charAt(0).toUpperCase() + status.slice(1), description: `Current registration status — ${status === "registered" ? "successfully registered with the SIP server" : status === "failed" ? "registration attempt failed" : status === "unregistered" ? "not currently registered" : "status unknown"}.` }),
  regAgentBadge: { title: "Remote Agent", description: "This registrar was tested via a remote agent — results reflect the agent's network path to the SIP server." },
  regResponseCode: { title: "SIP Response Code", description: "The SIP status code returned by the server (e.g. 200 OK, 401 Unauthorized, 403 Forbidden)." },
  regResponseTime: { title: "Response Time", description: "Round-trip time for the SIP REGISTER request — lower is better. High values may indicate network congestion or server load." },
  regHealthScore: { title: "Health Score", description: "Composite metric (0–100) derived from uptime percentage, average response time, and test pass rate." },
  regUptimePercent: { title: "Uptime", description: "Percentage of time this registrar has been successfully registered with its SIP server." },
  regPassRate: { title: "Pass Rate", description: "Percentage of registration tests that completed successfully." },
  regNetworkQuality: { title: "Network Quality", description: "Overall network quality assessment based on latency, jitter, and packet loss to the SIP server." },
  regLastSuccess: { title: "Last Success", description: "Time since the most recent successful registration." },
  regRegistrationStatus: { title: "Registration", description: "Percentage of registrars currently registered with their SIP server." },
  regAvgResponseTime: { title: "Avg Response Time", description: "Average SIP REGISTER round-trip time across all monitored registrars." },

  // ——— Registration: Folder Manager ———
  regFolderRename: { title: "Rename Folder", description: "Double-click to rename this folder." },
  regFolderMoveUp: { title: "Move Up", description: "Move this folder up in the list." },
  regFolderMoveDown: { title: "Move Down", description: "Move this folder down in the list." },
  regFolderDelete: { title: "Delete Folder", description: "Delete this folder. Registrars inside will be moved to Unfiled." },
  regFolderCreate: { title: "Create Folder", description: "Create a new folder to organize registrars." },
  regFolderCancel: { title: "Cancel", description: "Cancel the current operation." },

  // ——— Settings ———
  settingsGeneral: { title: "General", description: "Date, time, weather, and window behavior settings." },
  settingsNotifications: { title: "Notifications", description: "Configure notification preferences and alerts." },
  settingsUserAgent: { title: "User-Agent", description: "Customize the SIP/HTTP User-Agent string sent in requests." },
  settingsPacketMonitor: { title: "Packet Monitor", description: "Capture engine configuration and performance tuning." },
  settingsFax: { title: "Fax", description: "T.30/T.38 fax send and receive settings." },
  settingsTerminal: { title: "Terminal", description: "Terminal emulator appearance and behavior." },
  settingsSoftPhone: { title: "Soft Phone", description: "Built-in SIP softphone configuration." },
  settingsResetDefaults: { title: "Reset to Defaults", description: "Restore all settings in this section to their factory defaults." },
  settingsAdmin: { title: "Admin Panel", description: "Open the administration panel for advanced configuration." },
} as const;

/**
 * Use in components: pass the result as content or title/description.
 * For function entries, call them first: e.g. tooltips.regDeleteSelected(3)
 */
