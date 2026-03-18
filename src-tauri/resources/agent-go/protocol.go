package main

import "encoding/json"

// ---------------------------------------------------------------------------
// Envelope: every WebSocket message is wrapped in one of these
// ---------------------------------------------------------------------------

// AgentMessage is sent from the controller to the agent.
// JSON: {"id":"...","command":"Ping","params":{...}}
type AgentMessage struct {
	ID      string          `json:"id"`
	Command string          `json:"command"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// AgentReply is sent from the agent back to the controller.
// JSON: {"id":"...","type":"Result","data":{...}}
type AgentReply struct {
	ID   string      `json:"id"`
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// ---------------------------------------------------------------------------
// Command parameters (controller -> agent)
// ---------------------------------------------------------------------------

type PingParams struct {
	Host      string `json:"host"`
	Count     uint32 `json:"count"`
	TimeoutMs uint64 `json:"timeout_ms"`
}

type TracerouteParams struct {
	Host      string `json:"host"`
	MaxHops   uint8  `json:"max_hops"`
	TimeoutMs uint64 `json:"timeout_ms"`
}

type DnsLookupParams struct {
	Hostname   string  `json:"hostname"`
	Server     *string `json:"server"`
	RecordType string  `json:"record_type"`
}

type PortScanParams struct {
	Host      string `json:"host"`
	Ports     string `json:"ports"`
	Transport string `json:"transport"` // "tcp" (default), "udp", or "both"
	TimeoutMs uint64 `json:"timeout_ms"`
}

type SipRegistrationTestParams struct {
	Registrar  string  `json:"registrar"`
	Username   string  `json:"username"`
	Password   string  `json:"password"`
	Port       uint16  `json:"port"`
	Transport  string  `json:"transport"`
	Domain     *string `json:"domain"`
	Unregister bool    `json:"unregister"`
}

type SipProbeParams struct {
	Target    string `json:"target"`
	Port      uint16 `json:"port"`
	Transport string `json:"transport"`
	Method    string `json:"method"`
}

type StunTestParams struct {
	Server string `json:"server"`
}

type PacketCaptureParams struct {
	Interface    *string `json:"interface"`
	Filter       *string `json:"filter"`
	MaxPackets   uint32  `json:"max_packets"`
	DurationSecs uint32  `json:"duration_secs"`
	Continuous   bool    `json:"continuous"` // if true, runs until cancelled
}

type SipCallParams struct {
	Target       string  `json:"target"`
	Port         uint16  `json:"port"`
	CallerID     string  `json:"caller_id"`
	ToUser       string  `json:"to_user"`
	Domain       *string `json:"domain"`
	DurationSecs uint32  `json:"duration_secs"`
	Username     string  `json:"username"`
	Password     string  `json:"password"`
}

type FaxSendParams struct {
	Target     string  `json:"target"`
	FaxNumber  string  `json:"fax_number"`
	Port       uint16  `json:"port"`
	CallerID   string  `json:"caller_id"`
	StationID  string  `json:"station_id"`
	Domain     *string `json:"domain"`
	Username   string  `json:"username"`
	Password   string  `json:"password"`
	BaudRate   uint32  `json:"baud_rate"`   // 2400, 4800, 7200, 9600, 14400 (default: 9600)
	ECM        bool    `json:"ecm"`         // Error Correction Mode
	Resolution string  `json:"resolution"`  // "standard" or "fine" (default: "standard")
	HeaderLine string  `json:"header_line"` // Text printed at top of fax page
}

type HangupCallParams struct {
	CommandID string `json:"command_id"` // ID of the running SipCall command to hang up
}

type DnsSipResolveParams struct {
	Domain string  `json:"domain"`
	Server *string `json:"server"`
	Port   *uint16 `json:"port"`
}

type DnsReverseParams struct {
	IP     string  `json:"ip"`
	Server *string `json:"server"`
	Port   *uint16 `json:"port"`
	FCrDNS bool    `json:"fcrdns"`
}

type DnsDigParams struct {
	Domain     string        `json:"domain"`
	RecordType string        `json:"record_type"`
	Server     *string       `json:"server"`
	Port       *uint16       `json:"port"`
	UseTCP     bool          `json:"use_tcp"`
	Flags      *DnsDigFlags  `json:"flags"`
}

type DnsDigFlags struct {
	RD *bool `json:"rd"`
	CD *bool `json:"cd"`
	AD *bool `json:"ad"`
}

type DnsGeoIpParams struct {
	IPs []string `json:"ips"`
}

type DeviceScanParams struct {
	Network    *string `json:"network"`
	BannerGrab bool    `json:"banner_grab"`
}

// ── MTR ─────────────────────────────────────────────────────────────────

type MtrParams struct {
	Host       string `json:"host"`
	MaxHops    uint8  `json:"max_hops"`
	Rounds     uint32 `json:"rounds"`
	IntervalMs uint64 `json:"interval_ms"`
	TimeoutMs  uint64 `json:"timeout_ms"`
}

// ── NTP ─────────────────────────────────────────────────────────────────

type NtpCheckParams struct {
	Servers   []string `json:"servers"`
	TimeoutMs uint64   `json:"timeout_ms"`
}

// ── NAT / ALG Detection ─────────────────────────────────────────────────

type NatDetectParams struct {
	StunServer  string `json:"stun_server"`
	StunServer2 string `json:"stun_server_2"`
}

// ── SNMP ────────────────────────────────────────────────────────────────

type SnmpPollParams struct {
	Host      string   `json:"host"`
	Community string   `json:"community"`
	Version   int      `json:"version"`
	OIDs      []string `json:"oids"`
}

// ── Syslog Receiver ─────────────────────────────────────────────────────

type SyslogListenParams struct {
	Port           uint16   `json:"port"`
	DurationSecs   uint32   `json:"duration_secs"`
	FilterSeverity *string  `json:"filter_severity"`
	FilterFacility *string  `json:"filter_facility"`
	MaxEntries     uint32   `json:"max_entries"`
}

// ── Log File Viewer ─────────────────────────────────────────────────────

type FetchLogParams struct {
	Path      string  `json:"path"`
	TailLines *uint32 `json:"tail_lines"`
	Filter    *string `json:"filter"`
}

type TailLogParams struct {
	Path   string  `json:"path"`
	Filter *string `json:"filter"`
}

// ── File Browser / ListDir ──────────────────────────────────────────────

type ListDirParams struct {
	Path       string `json:"path"`
	ShowHidden bool   `json:"show_hidden"`
}

// ── File Server ─────────────────────────────────────────────────────────

type FileServeParams struct {
	Path         string            `json:"path"`
	HTTPPort     uint16            `json:"http_port"`
	TFTPPort     uint16            `json:"tftp_port"`
	Protocols    []string          `json:"protocols"`
	DurationSecs uint32            `json:"duration_secs"`
	Files        []PushedFile      `json:"files"`
}

type PushedFile struct {
	Name          string `json:"name"`
	ContentBase64 string `json:"content_base64"`
}

// ── Interactive Remote Shell ────────────────────────────────────────────

type ShellSpawnParams struct {
	Cols  uint16  `json:"cols"`
	Rows  uint16  `json:"rows"`
	Shell *string `json:"shell"`
}

type ShellInputParams struct {
	SessionID string `json:"session_id"`
	Data      string `json:"data"`
}

type ShellResizeParams struct {
	SessionID string `json:"session_id"`
	Cols      uint16 `json:"cols"`
	Rows      uint16 `json:"rows"`
}

type ShellCloseParams struct {
	SessionID string `json:"session_id"`
}

type ChatMessageParams struct {
	Text   string  `json:"text"`
	Sender *string `json:"sender,omitempty"`
}

// ---------------------------------------------------------------------------
// Response data types (agent -> controller)
// ---------------------------------------------------------------------------

type ResultData struct {
	Success   bool        `json:"success"`
	Result    interface{} `json:"result"`
	ElapsedMs uint64      `json:"elapsed_ms"`
}

type ErrorData struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ProgressData struct {
	Progress *float64    `json:"progress,omitempty"`
	Message  string      `json:"message"`
	Partial  interface{} `json:"partial,omitempty"`
}

type StreamChunk struct {
	Seq        uint64      `json:"seq"`
	Data       string      `json:"data"`
	FinalChunk bool        `json:"final_chunk"`
	PacketInfo *PacketInfo `json:"packet_info,omitempty"`
}

// PacketInfo holds parsed packet header information for display (tcpdump-style).
type PacketInfo struct {
	Timestamp string  `json:"timestamp"`
	SrcIP     string  `json:"src_ip"`
	DstIP     string  `json:"dst_ip"`
	Protocol  string  `json:"protocol"`
	Length    int     `json:"length"`
	SrcPort   *uint16 `json:"src_port,omitempty"`
	DstPort   *uint16 `json:"dst_port,omitempty"`
	Info      string  `json:"info"` // tcpdump-style summary line
	TCPFlags  *string `json:"tcp_flags,omitempty"`
}

type AckData struct {
	Command string `json:"command"`
	Message string `json:"message"`
}

type ChatMessageData struct {
	Text      string `json:"text"`
	Sender    string `json:"sender"`
	Timestamp string `json:"timestamp"`
}

type HeartbeatData struct {
	AgentID      string             `json:"agent_id"`
	Hostname     string             `json:"hostname"`
	OS           string             `json:"os"`
	OSVersion    string             `json:"os_version"`
	Arch         string             `json:"arch"`
	Kernel       string             `json:"kernel"`
	CPUs         int                `json:"cpus"`
	MemoryMB     uint64             `json:"memory_mb"`
	UptimeSecs   uint64             `json:"uptime_secs"`
	LocalIP      string             `json:"local_ip"`
	PublicIP     string             `json:"public_ip,omitempty"`
	Gateway      string             `json:"gateway,omitempty"`
	Interfaces   []NetworkInterface `json:"interfaces"`
	Profile      string             `json:"profile"`
	Capabilities []string           `json:"capabilities"`
}

type NetworkInterface struct {
	Name string  `json:"name"`
	IP   *string `json:"ip"`
	MAC  *string `json:"mac"`
	IsUp bool    `json:"is_up"`
}

// ---------------------------------------------------------------------------
// Tool result types
// ---------------------------------------------------------------------------

type PingResult struct {
	Host            string      `json:"host"`
	ResolvedIP      string      `json:"resolved_ip"`
	Probes          []PingProbe `json:"probes"`
	PacketsSent     uint32      `json:"packets_sent"`
	PacketsReceived uint32      `json:"packets_received"`
	PacketLossPct   float64     `json:"packet_loss_pct"`
	MinMs           float64     `json:"min_ms"`
	AvgMs           float64     `json:"avg_ms"`
	MaxMs           float64     `json:"max_ms"`
	JitterMs        float64     `json:"jitter_ms"`
}

type PingProbe struct {
	Seq   uint32   `json:"seq"`
	RttMs *float64 `json:"rtt_ms"`
	TTL   *uint8   `json:"ttl"`
	Error *string  `json:"error"`
}

type TracerouteResult struct {
	Host       string          `json:"host"`
	ResolvedIP string          `json:"resolved_ip"`
	Hops       []TracerouteHop `json:"hops"`
}

type TracerouteHop struct {
	TTL      uint8    `json:"ttl"`
	Addr     *string  `json:"addr"`
	Hostname *string  `json:"hostname"`
	RttMs    *float64 `json:"rtt_ms"`
}

type DnsResult struct {
	Query      string      `json:"query"`
	RecordType string      `json:"record_type"`
	Server     *string     `json:"server"`
	Records    []DnsRecord `json:"records"`
	ElapsedMs  uint64      `json:"elapsed_ms"`
}

type DnsRecord struct {
	RecordType string  `json:"record_type"`
	Value      string  `json:"value"`
	TTL        *uint32 `json:"ttl"`
}

type PortScanResult struct {
	Host          string     `json:"host"`
	Transport     string     `json:"transport"`
	OpenPorts     []PortInfo `json:"open_ports"`
	ClosedCount   uint32     `json:"closed_count"`
	FilteredCount uint32     `json:"filtered_count"`
	TotalScanned  int        `json:"total_scanned"`
	ElapsedMs     uint64     `json:"elapsed_ms"`
}

type PortInfo struct {
	Port      uint16  `json:"port"`
	State     string  `json:"state"`
	Transport string  `json:"transport"` // "tcp" or "udp"
	Service   *string `json:"service"`
	Banner    *string `json:"banner"`
}

type StunResult struct {
	Server     string `json:"server"`
	PublicIP   string `json:"public_ip"`
	PublicPort uint16 `json:"public_port"`
	NatType    string `json:"nat_type"`
	ElapsedMs  uint64 `json:"elapsed_ms"`
}

type DeviceScanResult struct {
	Network string             `json:"network"`
	Devices []DiscoveredDevice `json:"devices"`
}

type DiscoveredDevice struct {
	IP        string   `json:"ip"`
	MAC       *string  `json:"mac"`
	Hostname  *string  `json:"hostname"`
	Vendor    *string  `json:"vendor"`
	OpenPorts []uint16 `json:"open_ports"`
	Banner    *string  `json:"banner"`
}

// ── DNS advanced result types ───────────────────────────────────────────

type DnsSipResolveResult struct {
	Domain  string              `json:"domain"`
	Steps   []SipResolveStep    `json:"steps"`
	Targets []SipResolveTarget  `json:"targets"`
}

type SipResolveStep struct {
	Type      string      `json:"type"`      // "NAPTR", "SRV", "A", "AAAA"
	Query     string      `json:"query"`
	Records   []DnsRecord `json:"records"`
	ElapsedMs uint64      `json:"elapsed_ms"`
	Error     *string     `json:"error,omitempty"`
}

type SipResolveTarget struct {
	Host      string `json:"host"`
	Port      uint16 `json:"port"`
	Transport string `json:"transport"`
	Priority  uint16 `json:"priority"`
	Weight    uint16 `json:"weight"`
}

type DnsReverseResult struct {
	IP        string   `json:"ip"`
	Hostnames []string `json:"hostnames"`
	Verified  *bool    `json:"verified,omitempty"` // FCrDNS result
	ElapsedMs uint64   `json:"elapsed_ms"`
}

type DnsDigResult struct {
	Query      string       `json:"query"`
	RecordType string       `json:"record_type"`
	Server     string       `json:"server"`
	Status     string       `json:"status"`
	Flags      DigResFlags  `json:"flags"`
	Answer     []DnsRecord  `json:"answer"`
	Authority  []DnsRecord  `json:"authority"`
	Additional []DnsRecord  `json:"additional"`
	ElapsedMs  uint64       `json:"elapsed_ms"`
}

type DigResFlags struct {
	QR bool `json:"qr"`
	AA bool `json:"aa"`
	TC bool `json:"tc"`
	RD bool `json:"rd"`
	RA bool `json:"ra"`
	AD bool `json:"ad"`
	CD bool `json:"cd"`
}

type GeoIpResult struct {
	IP          string  `json:"ip"`
	Country     *string `json:"country,omitempty"`
	CountryCode *string `json:"country_code,omitempty"`
	Region      *string `json:"region,omitempty"`
	City        *string `json:"city,omitempty"`
	Lat         *float64 `json:"lat,omitempty"`
	Lon         *float64 `json:"lon,omitempty"`
	ISP         *string `json:"isp,omitempty"`
	Org         *string `json:"org,omitempty"`
	AS          *string `json:"as,omitempty"`
	Error       *string `json:"error,omitempty"`
}

type GeoIpBatchResult struct {
	Results []GeoIpResult `json:"results"`
}

type SystemInfoResult struct {
	// Core system
	Hostname  string `json:"hostname"`
	OS        string `json:"os"`
	OSVersion string `json:"os_version"`
	Kernel    string `json:"kernel"`
	Arch      string `json:"arch"`
	CPUs      int    `json:"cpus"`
	MemoryMB  uint64 `json:"memory_mb"`
	GoVersion string `json:"go_version"`

	// Timing / locale
	UptimeSecs uint64 `json:"uptime_secs"`
	Timezone   string `json:"timezone"`
	LocalTime  string `json:"local_time"`
	Locale     string `json:"locale"`

	// Load
	LoadAvg1  float64 `json:"load_avg_1"`
	LoadAvg5  float64 `json:"load_avg_5"`
	LoadAvg15 float64 `json:"load_avg_15"`

	// Network
	Interfaces     []NetworkInterface `json:"interfaces"`
	DefaultGateway *string            `json:"default_gateway"`
	PublicIP       *string            `json:"public_ip"`
	DNSServers     []string           `json:"dns_servers"`
	DNSSearch      []string           `json:"dns_search"`
	NetworkDetails []NetIfaceDetail   `json:"network_details"`
	Routes         []RouteEntry       `json:"routes"`
	Listeners      []ListenerEntry    `json:"listeners"`

	// Disk
	Disks []DiskInfo `json:"disks"`

	// Environment
	EnvHints map[string]string `json:"env_hints"`

	// Current user
	Username  string   `json:"username"`
	HomeDir   string   `json:"home_dir"`
	Shell     string   `json:"shell"`
	Groups    []string `json:"groups"`
	IsRoot    bool     `json:"is_root"`
}

type NetIfaceDetail struct {
	Name      string   `json:"name"`
	IP        *string  `json:"ip,omitempty"`
	IPv6      []string `json:"ipv6,omitempty"`
	Subnet    *string  `json:"subnet,omitempty"`
	MAC       *string  `json:"mac,omitempty"`
	MTU       int      `json:"mtu"`
	IsUp      bool     `json:"is_up"`
	Flags     string   `json:"flags"`
	IfaceType string   `json:"iface_type,omitempty"`
}

type RouteEntry struct {
	Destination string `json:"destination"`
	Gateway     string `json:"gateway"`
	Iface       string `json:"iface"`
	Metric      string `json:"metric,omitempty"`
	Flags       string `json:"flags,omitempty"`
}

type ListenerEntry struct {
	Proto   string `json:"proto"`
	Address string `json:"address"`
	Port    uint16 `json:"port"`
	PID     string `json:"pid,omitempty"`
	Process string `json:"process,omitempty"`
}

type DiskInfo struct {
	Mount     string `json:"mount"`
	Device    string `json:"device"`
	FSType    string `json:"fs_type"`
	TotalMB   uint64 `json:"total_mb"`
	UsedMB    uint64 `json:"used_mb"`
	AvailMB   uint64 `json:"avail_mb"`
	UsePct    string `json:"use_pct"`
}

// ── MTR result types ────────────────────────────────────────────────────

type MtrResult struct {
	Host       string   `json:"host"`
	ResolvedIP string   `json:"resolved_ip"`
	Hops       []MtrHop `json:"hops"`
	Rounds     uint32   `json:"rounds"`
}

type MtrHop struct {
	Hop      uint8   `json:"hop"`
	IP       string  `json:"ip"`
	Hostname string  `json:"hostname"`
	LossPct  float64 `json:"loss_pct"`
	Sent     uint32  `json:"sent"`
	Received uint32  `json:"received"`
	BestMs   float64 `json:"best_ms"`
	WorstMs  float64 `json:"worst_ms"`
	AvgMs    float64 `json:"avg_ms"`
	LastMs   float64 `json:"last_ms"`
	StdevMs  float64 `json:"stdev_ms"`
	JitterMs float64 `json:"jitter_ms"`
}

// ── NTP result types ────────────────────────────────────────────────────

type NtpCheckResult struct {
	Servers   []NtpServerResult `json:"servers"`
	LocalTime string            `json:"local_time"`
	UtcTime   string            `json:"utc_time"`
	ClockStatus string          `json:"clock_status"` // "ok", "warning", "critical"
}

type NtpServerResult struct {
	Server      string  `json:"server"`
	Stratum     uint8   `json:"stratum"`
	OffsetMs    float64 `json:"offset_ms"`
	DelayMs     float64 `json:"delay_ms"`
	ReferenceID string  `json:"reference_id"`
	Success     bool    `json:"success"`
	Error       *string `json:"error,omitempty"`
}

// ── NAT / ALG result types ──────────────────────────────────────────────

type NatDetectResult struct {
	NatType          string   `json:"nat_type"`
	MappedIP         string   `json:"mapped_ip"`
	MappedPort       uint16   `json:"mapped_port"`
	LocalIP          string   `json:"local_ip"`
	LocalPort        uint16   `json:"local_port"`
	HairpinSupported bool     `json:"hairpin_supported"`
	AlgDetected      bool     `json:"alg_detected"`
	ModifiedHeaders  []string `json:"modified_headers"`
	UdpTimeoutSecs   uint32   `json:"udp_timeout_secs"`
	ElapsedMs        uint64   `json:"elapsed_ms"`
}

// ── SNMP result types ───────────────────────────────────────────────────

type SnmpPollResult struct {
	SystemInfo SnmpSystemInfo  `json:"system_info"`
	Interfaces []SnmpInterface `json:"interfaces"`
	ElapsedMs  uint64          `json:"elapsed_ms"`
}

type SnmpSystemInfo struct {
	SysName     string `json:"sys_name"`
	SysDescr    string `json:"sys_descr"`
	SysUpTime   string `json:"sys_uptime"`
	SysContact  string `json:"sys_contact"`
	SysLocation string `json:"sys_location"`
}

type SnmpInterface struct {
	Index       int    `json:"index"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Speed       uint64 `json:"speed"`
	OperStatus  string `json:"oper_status"`
	InOctets    uint64 `json:"in_octets"`
	OutOctets   uint64 `json:"out_octets"`
	InErrors    uint64 `json:"in_errors"`
	OutErrors   uint64 `json:"out_errors"`
	InDiscards  uint64 `json:"in_discards"`
	OutDiscards uint64 `json:"out_discards"`
}

// ── Syslog result types ─────────────────────────────────────────────────

type SyslogEntry struct {
	Timestamp string `json:"timestamp"`
	Hostname  string `json:"hostname"`
	Facility  string `json:"facility"`
	Severity  string `json:"severity"`
	AppName   string `json:"app_name"`
	ProcessID string `json:"process_id"`
	Message   string `json:"message"`
}

type SyslogSummary struct {
	TotalMessages   uint32            `json:"total_messages"`
	SeverityCounts  map[string]uint32 `json:"severity_counts"`
	UniqueSources   []string          `json:"unique_sources"`
}

// ── Log Fetch result types ──────────────────────────────────────────────

type FetchLogResult struct {
	Lines        []string `json:"lines"`
	TotalLines   uint32   `json:"total_lines"`
	MatchedLines uint32   `json:"matched_lines"`
	FileSizeBytes uint64  `json:"file_size_bytes"`
}

// ── File Server result types ────────────────────────────────────────────

type FileServeStatus struct {
	HttpURL  string `json:"http_url"`
	TftpURL  string `json:"tftp_url"`
	Serving  bool   `json:"serving"`
}

type FileServeRequest struct {
	Timestamp  string `json:"timestamp"`
	ClientIP   string `json:"client_ip"`
	Filename   string `json:"filename"`
	Status     int    `json:"status"`
	BytesSent  uint64 `json:"bytes_sent"`
	DurationMs uint64 `json:"duration_ms"`
	Protocol   string `json:"protocol"` // "http" or "tftp"
}

// ── Firmware Download ───────────────────────────────────────────────────

type FirmwareDownloadParams struct {
	EntryID       string `json:"entry_id"`
	URL           string `json:"url"`
	FallbackURL   string `json:"fallback_url"`
	Filename      string `json:"filename"`
	ArchiveFormat string `json:"archive_format"` // "" for direct, "tar.bz2" for Poly
	SHA256        string `json:"sha256"`
}

type FirmwareDownloadProgress struct {
	EntryID         string  `json:"entry_id"`
	DownloadedBytes uint64  `json:"downloaded_bytes"`
	TotalBytes      uint64  `json:"total_bytes"`
	Pct             float64 `json:"pct"`
	Phase           string  `json:"phase"`
	FilesExtracted  uint32  `json:"files_extracted"`
}

type FirmwareDownloadResult struct {
	EntryID   string   `json:"entry_id"`
	Path      string   `json:"path"`
	Dir       string   `json:"dir"`
	Filename  string   `json:"filename"`
	Files     []string `json:"files"`
	SizeBytes uint64   `json:"size_bytes"`
}

// ── Multicast ───────────────────────────────────────────────────────────

type MulticastJoinParams struct {
	Group     string  `json:"group"`
	Port      int     `json:"port"`
	Interface *string `json:"interface"`
}

type MulticastJoinResult struct {
	Success bool    `json:"success"`
	Group   string  `json:"group"`
	Error   *string `json:"error,omitempty"`
}

type MulticastIgmpQueryParams struct {
	Interface *string `json:"interface"`
}

type IgmpGroupEntry struct {
	Group             string `json:"group"`
	LastReporter      string `json:"last_reporter"`
	IgmpVersion       int    `json:"igmp_version"`
	CompatibilityMode string `json:"compatibility_mode"`
}

type MulticastIgmpQueryResult struct {
	GroupsFound []IgmpGroupEntry `json:"groups_found"`
	IgmpVersion int              `json:"igmp_version"`
	QueryTimeMs uint64           `json:"query_time_ms"`
	Responders  int              `json:"responders"`
}

type MulticastSnoopingVerifyParams struct {
	Group     string  `json:"group"`
	Interface *string `json:"interface"`
}

type MulticastSnoopingVerifyResult struct {
	Group         string   `json:"group"`
	SnoopingActive bool    `json:"snooping_active"`
	JoinLatencyMs  float64 `json:"join_latency_ms"`
	LeaveVerified  bool    `json:"leave_verified"`
	TTLCheck       bool    `json:"ttl_check"`
	Details        []string `json:"details"`
}

type MulticastSendTestParams struct {
	Group      string  `json:"group"`
	Port       int     `json:"port"`
	Count      int     `json:"count"`
	IntervalMs int     `json:"interval_ms"`
	TTL        int     `json:"ttl"`
}

type MulticastSendTestResult struct {
	Success   bool    `json:"success"`
	Group     string  `json:"group"`
	Sent      int     `json:"sent"`
	ElapsedMs uint64  `json:"elapsed_ms"`
	Error     *string `json:"error,omitempty"`
}

// ── Schedule ────────────────────────────────────────────────────────────

type UpdateScheduleParams struct {
	Entries  []ScheduleEntry       `json:"entries"`
	Schedule []ScheduleTimeWindow  `json:"schedule,omitempty"` // backward compatibility
}

// ScheduleTimeWindow is the legacy shape sent by older controllers.
type ScheduleTimeWindow struct {
	Days      []string `json:"days"`
	StartTime string   `json:"start_time"`
	EndTime   string   `json:"end_time"`
}

type ScheduleEntry struct {
	Command    string          `json:"command"`
	Params     json.RawMessage `json:"params"`
	IntervalMs int             `json:"interval_ms"`
	Enabled    bool            `json:"enabled"`
}

type UpdateScheduleResult struct {
	Accepted int `json:"accepted"`
	Active   int `json:"active"`
}

// ── FetchProvision ──────────────────────────────────────────────────────

type FetchProvisionParams struct {
	ProviderUrl    string  `json:"provider_url"`
	Mac            string  `json:"mac"`
	Model          string  `json:"model"`
	IncludeMacInUa *bool   `json:"include_mac_in_ua,omitempty"`
	Vendor         *string `json:"vendor,omitempty"`
}

type FetchProvisionResult struct {
	Raw         string                  `json:"raw"`
	Parsed      *ParsedProvisionCfg     `json:"parsed"`
	RequestInfo ProvisionRequestInfo    `json:"request_info"`
	Parseable   bool                    `json:"parseable"`
}

type ParsedProvisionCfg struct {
	Groups  map[string][]ProvisionKeyValue `json:"groups"`
	Entries []ProvisionKeyValue            `json:"entries"`
}

type ProvisionKeyValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type ProvisionRequestInfo struct {
	FinalUrl  string   `json:"final_url"`
	UserAgent string   `json:"user_agent"`
	MacUsed   string   `json:"mac_used"`
	Status    int      `json:"status"`
	Redirects []string `json:"redirects,omitempty"`
	RetryLog  []string `json:"retry_log,omitempty"`
}

// ── ListDir result types ────────────────────────────────────────────────

type ListDirResult struct {
	Path    string         `json:"path"`
	Entries []DirEntry     `json:"entries"`
	Error   string         `json:"error,omitempty"`
}

type DirEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	ModTime string `json:"mod_time"`
	Mode    string `json:"mode"`
}
