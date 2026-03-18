export interface NetworkInterface {
  name: string;
  description: string;
  addresses: string[];
  /** True when this interface is the system default route (e.g. VPN when active). */
  isDefault?: boolean;
}

export interface FilterConfig {
  protocols: string[];
  srcIpRanges: string[];
  dstIpRanges: string[];
  srcPorts: number[];
  dstPorts: number[];
  portRanges: [number, number][];
  rtpPortRange?: [number, number]; // Optional RTP port range for detection (min, max)
}

export interface CaptureSource {
  type: "local" | "remote";
  host?: string;
  username?: string;
}

export interface CaptureSession {
  id: string;
  name: string;
  description?: string;
  interface: string;
  filterConfig: FilterConfig;
  startTime: string;
  endTime?: string;
  status: string;
  packetCount: number;
  filePath: string;
  source?: CaptureSource;
  folderId?: string;
  tags: string[];
}

export interface CaptureFolder {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export type SshAuthMethod = "password" | "keyFile" | "agent";

export interface RemoteCaptureConfig {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  keyPath?: string;
  remoteInterface: string;
  captureFilter?: string;
  useSudo: boolean;
  sudoPassword?: string;
  sessionName?: string;
  packetLimit?: number;
  durationSeconds?: number;
}

export interface CaptureCapabilityReport {
  platform: string;
  localCaptureSupported: boolean;
  localCaptureReason?: string | null;
  remoteCaptureSupported: boolean;
  remoteCaptureReason?: string | null;
  remoteCaptureNotes: string[];
  /** Strict mode defaults to true and blocks local native capture unless explicitly enabled. */
  strictModeEnabled?: boolean;
  /** Whether local capture is enabled by runtime env/config gate. */
  localCaptureEnabled?: boolean;
  /** Result of probing local native capture support on this host. */
  localCaptureProbeSucceeded?: boolean;
  localCaptureProbeReason?: string | null;
}

export interface ScheduledCapture {
  id: string;
  name: string;
  description?: string;
  interface: string;
  filterConfig: FilterConfig;
  scheduleType: 'one_time' | 'recurring';
  scheduledTime: string;
  durationSeconds?: number;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

export interface RtpStreamInfo {
  ssrc: number;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  payloadType: number;
  codecName: string;
  packetCount: number;
  lostPackets: number;
  lossPercentage: number;
  jitter: number;
  mosScore: number;
  firstPacketTime: string;
  lastPacketTime: string;
  /** Audio analysis fields (populated when audio decode has run). */
  hasAudio?: boolean;
  audioIssues?: import("@/types/forensics").AudioIssue[];
}

/** Per-second snapshot of RTP stream quality metrics for time-series graphs. */
export interface RtpHistoryBucket {
  /** ISO 8601 timestamp for this bucket (start of second) */
  timestamp: string;
  /** Packets received in this second */
  packets: number;
  /** Packets lost in this second */
  lost: number;
  /** Loss percentage for this second */
  lossPercent: number;
  /** Jitter (ms) at end of this second */
  jitter: number;
  /** MOS score at end of this second */
  mos: number;
}

/** Time-series history for an RTP stream (used for quality graphs). */
export interface RtpStreamHistory {
  ssrc: number;
  codecName: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  /** Per-second quality buckets (max 300 = 5 minutes) */
  buckets: RtpHistoryBucket[];
}

export interface CaptureStatistics {
  totalPackets: number;
  totalBytes: number;
  packetsByProtocol: Record<string, number>;
  bytesByProtocol: Record<string, number>;
  topSrcIps: [string, number][];
  topDstIps: [string, number][];
  packetsPerSecond: number;
  bytesPerSecond: number;
  startTime?: string;
  lastPacketTime?: string;
}

export type PacketDataFidelity = "authoritative" | "derived" | "simulated" | "unknown";

export interface PacketProvenance {
  /** Fidelity classification provided by backend analysis. */
  fidelity?: PacketDataFidelity;
  /** Human-readable source of truth (for example "pcap", "decoder", "simulation"). */
  source?: string;
  /** Optional backend method/pipeline name that produced this packet view. */
  method?: string;
  /** Optional additional provenance details shown in UI tooltips/copy. */
  details?: string;
}

export interface PacketInfo {
  /** Original packet index in the session (when provided by backend). */
  originalIndex?: number;
  timestamp: string;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: string;
  size: number;
  /** Full captured frame length (wire/caplen). When present, `size` is payload length. */
  frameLength?: number;
  summary: string;
  /** Raw application payload bytes for RTP/DNS (used by Raw tab). */
  rawPayload?: number[];
  /** Packet fidelity from backend (preferred field). */
  dataFidelity?: PacketDataFidelity;
  /** Packet provenance from backend (preferred field). */
  dataProvenance?: PacketProvenance;
  /** Backward/alternate backend field for fidelity. */
  fidelity?: PacketDataFidelity;
  /** Backward/alternate backend field for provenance. */
  provenance?: PacketProvenance | string;
  decoded?: DecodedPacket;
}

export interface DecodedPacket {
  ethernet?: EthernetHeader;
  ip?: IpHeader;
  udp?: UdpHeader;
  tcp?: TcpHeader;
  application: ApplicationLayer;
}

export interface EthernetHeader {
  dstMac: string;
  srcMac: string;
  ethertype: number;
}

export interface IpHeader {
  version: number;
  headerLength: number;
  tos: number;
  totalLength: number;
  identification: number;
  flags: number;
  fragmentOffset: number;
  ttl: number;
  protocol: number;
  checksum: number;
  srcIp: string;
  dstIp: string;
}

export interface UdpHeader {
  srcPort: number;
  dstPort: number;
  length: number;
  checksum: number;
}

export interface TcpHeader {
  srcPort: number;
  dstPort: number;
  sequence: number;
  acknowledgment: number;
  dataOffset: number;
  flags: number;
  window: number;
  checksum: number;
  urgentPointer: number;
}

export interface ParsedSipMessage {
  method?: string;
  responseCode?: number;
  responseText?: string;
  requestUri?: string;
  headers: Record<string, string>;
  body?: SipBody;
  callId?: string;
  from?: string;
  to?: string;
  cseq?: string;
  via: string[];
  contact?: string;
  contentType?: string;
  contentLength?: number;
  rawMessage: string;
}

export interface SipBody {
  contentType: string;
  content: string;
  sdp?: ParsedSdp;
}

export interface ParsedSdp {
  version?: string;
  origin?: string;
  sessionName?: string;
  connection?: string;
  timing?: string;
  media: SdpMedia[];
  attributes: string[];
}

export interface SdpMedia {
  mediaType: string;
  port?: number;
  /** Number of ports from m= line (e.g. 49170/2 → portCount=2). Defaults to 1. */
  portCount?: number;
  protocol?: string;
  payloadTypes: number[];
  attributes: string[];
  /** Media-level connection data (c= line), if present. */
  connection?: string;
}

export interface RtpHeader {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  csrc: number[];
  extensionLength?: number;
  dtmfEvent?: DtmfEvent;
  encrypted?: boolean;
}

export interface DtmfEvent {
  event: number;
  digit: string;
  endOfEvent: boolean;
  volume: number;
  duration: number;
}

/** RTCP compound packet containing multiple RTCP sub-packets */
export interface RtcpCompoundPacket {
  packets: RtcpPacket[];
}

/** A single RTCP packet (SR, RR, SDES, BYE, or APP) */
export interface RtcpPacket {
  version: number;
  padding: boolean;
  count: number;
  packetType: number;  // 200=SR, 201=RR, 202=SDES, 203=BYE, 204=APP, 207=XR
  length: number;
  ssrc: number;
  senderReport?: RtcpSenderReport;
  receiverReports: RtcpReceiverReport[];
  sdesItems: RtcpSdesItem[];
  byeReason?: string;
  byeSsrcs: number[];
  voipMetrics?: VoipMetricsBlock;
}

/** RTCP-XR VoIP Metrics Report Block (RFC 3611 §4.7) */
export interface VoipMetricsBlock {
  ssrcSource: number;
  lossRate: number;
  discardRate: number;
  burstDensity: number;
  gapDensity: number;
  burstDuration: number;
  gapDuration: number;
  roundTripDelay: number;
  endSystemDelay: number;
  signalLevel: number;
  noiseLevel: number;
  rerl: number;
  gmin: number;
  rFactor: number;
  extRFactor: number;
  mosLq: number;
  mosCq: number;
  rxConfig: number;
  jbNominal: number;
  jbMaximum: number;
  jbAbsMax: number;
}

/** Sender Report data (for SR packets) */
export interface RtcpSenderReport {
  ntpTimestamp: number;  // Note: May lose precision - full is 64-bit
  rtpTimestamp: number;
  packetCount: number;
  octetCount: number;
}

/** Receiver Report block */
export interface RtcpReceiverReport {
  ssrc: number;
  fractionLost: number;
  cumulativeLost: number;
  highestSeq: number;
  jitter: number;
  lsr: number;
  dlsr: number;
}

/** SDES (Source Description) item */
export interface RtcpSdesItem {
  ssrc: number;
  itemType: number;
  itemTypeName: string;
  value: string;
}

export interface DnsMessage {
  transactionId: number;
  flags: number;
  questions: number;
  answerRrs: number;
  authorityRrs: number;
  additionalRrs: number;
  queries: DnsQuery[];
  answers: DnsResourceRecord[];
  isResponse: boolean;
  opcode: number;
  responseCode: number;
}

export interface DnsQuery {
  name: string;
  qtype: number;
  qclass: number;
}

export interface DnsResourceRecord {
  name: string;
  rtype: number;
  rclass: number;
  ttl: number;
  data: string;
}

/** T.38 UDPTL (FAX over IP) parsed packet for packet monitor. */
export interface T38UdpTLPacket {
  udptlType: number;
  seq: number;
  primaryLen: number;
  ifpType?: string;
  primaryPayloadLen: number;
}

/** WebSocket frame (used for SIP-over-WebSocket detection) */
export interface WebSocketFrame {
  fin: boolean;
  rsv1: boolean;
  rsv2: boolean;
  rsv3: boolean;
  opcode: number;
  opcodeName: string;
  masked: boolean;
  payloadLength: number;
  maskKey?: number[];
  payload: number[];
  headerSize: number;
}

export type ApplicationLayer = 
  | { type: "Sip"; data: ParsedSipMessage }
  | { type: "SipOverWs"; data: { wsFrame: WebSocketFrame; sip: ParsedSipMessage } }
  | { type: "Rtp"; data: RtpHeader }
  | { type: "Srtp"; data: RtpHeader }
  | { type: "Rtcp"; data: RtcpCompoundPacket }
  | { type: "Dns"; data: DnsMessage }
  | { type: "T38"; data: T38UdpTLPacket }
  | { type: "WebSocket"; data: WebSocketFrame }
  | { type: "Unknown"; data: number[] };

export interface ExpertFinding {
  id: string;
  ruleId: string;
  severity: "critical" | "warning" | "info";
  category: "signaling" | "media" | "network" | "security" | "performance" | "fax";
  domain?: "ucaas" | "sip" | "rtp" | "fax" | "network" | "cross_domain";
  title: string;
  description: string;
  detail?: string;
  evidence: FindingEvidence[];
  articleId?: string;
  relatedCallId?: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  confidenceScore?: number;
  explanationSummary?: string;
  explanationImpact?: string;
  explanationWhy?: string;
  furtherChecks?: string[];
}

export interface FindingEvidence {
  evidenceType: "packet" | "sipDialog" | "rtpStream" | "timestamp" | "value";
  value: string;
  label?: string;
  packetIndices: number[];
}
