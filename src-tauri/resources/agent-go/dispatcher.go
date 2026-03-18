package main

import (
	"encoding/json"
	"log"
	"time"
)

// ToolResponse wraps a response type + data, ready to be placed in an AgentReply.
type ToolResponse struct {
	Type string
	Data interface{}
}

// DispatchCommand routes a command to the appropriate tool handler.
func DispatchCommand(command string, params json.RawMessage) []ToolResponse {
	start := time.Now()

	switch command {
	case "Ping":
		var p PingParams
		p.Count = 4
		p.TimeoutMs = 5000
		json.Unmarshal(params, &p)
		result, err := RunPing(p)
		return wrapResult(result, err, "PING_ERROR", start)

	case "Traceroute":
		var p TracerouteParams
		p.MaxHops = 30
		p.TimeoutMs = 5000
		json.Unmarshal(params, &p)
		result, err := RunTraceroute(p)
		return wrapResult(result, err, "TRACEROUTE_ERROR", start)

	case "DnsLookup":
		var p DnsLookupParams
		p.RecordType = "A"
		json.Unmarshal(params, &p)
		result, err := RunDnsLookup(p)
		return wrapResult(result, err, "DNS_ERROR", start)

	case "DnsSipResolve":
		var p DnsSipResolveParams
		json.Unmarshal(params, &p)
		result, err := RunDnsSipResolve(p)
		return wrapResult(result, err, "DNS_SIP_RESOLVE_ERROR", start)

	case "DnsReverse":
		var p DnsReverseParams
		json.Unmarshal(params, &p)
		result, err := RunDnsReverse(p)
		return wrapResult(result, err, "DNS_REVERSE_ERROR", start)

	case "DnsDig":
		var p DnsDigParams
		p.RecordType = "A"
		json.Unmarshal(params, &p)
		result, err := RunDnsDig(p)
		return wrapResult(result, err, "DNS_DIG_ERROR", start)

	case "DnsGeoIp":
		var p DnsGeoIpParams
		json.Unmarshal(params, &p)
		result, err := RunDnsGeoIp(p)
		return wrapResult(result, err, "DNS_GEOIP_ERROR", start)

	case "PortScan":
		var p PortScanParams
		p.TimeoutMs = 5000
		json.Unmarshal(params, &p)
		result, err := RunPortScan(p)
		return wrapResult(result, err, "PORT_SCAN_ERROR", start)

	case "SipRegistrationTest":
		var p SipRegistrationTestParams
		p.Port = 5060
		p.Transport = "udp"
		json.Unmarshal(params, &p)
		result, err := RunSipRegistrationTest(p)
		return wrapResult(result, err, "SIP_REG_ERROR", start)

	case "SipProbe":
		var p SipProbeParams
		p.Port = 5060
		p.Transport = "udp"
		p.Method = "OPTIONS"
		json.Unmarshal(params, &p)
		result, err := RunSipProbe(p)
		return wrapResult(result, err, "SIP_PROBE_ERROR", start)

	case "StunTest":
		var p StunTestParams
		p.Server = "stun.l.google.com:19302"
		json.Unmarshal(params, &p)
		result, err := RunStunTest(p)
		return wrapResult(result, err, "STUN_ERROR", start)

	case "NtpCheck":
		var p NtpCheckParams
		p.TimeoutMs = 3000
		json.Unmarshal(params, &p)
		result, err := RunNtpCheck(p)
		return wrapResult(result, err, "NTP_ERROR", start)

	case "NatDetect":
		var p NatDetectParams
		p.StunServer = "stun.l.google.com:19302"
		json.Unmarshal(params, &p)
		result, err := RunNatDetect(p)
		return wrapResult(result, err, "NAT_DETECT_ERROR", start)

	case "SnmpPoll":
		var p SnmpPollParams
		p.Community = "public"
		p.Version = 2
		json.Unmarshal(params, &p)
		result, err := RunSnmpPoll(p)
		return wrapResult(result, err, "SNMP_ERROR", start)

	case "FetchLog":
		var p FetchLogParams
		json.Unmarshal(params, &p)
		result, err := RunFetchLog(p)
		return wrapResult(result, err, "FETCH_LOG_ERROR", start)

	case "ListDir":
		var p ListDirParams
		p.Path = "/"
		json.Unmarshal(params, &p)
		result, err := RunListDir(p)
		return wrapResult(result, err, "LIST_DIR_ERROR", start)

	// SipCall is handled as a cancellable command in connection.go
	// and is never dispatched through this synchronous path.

	case "FaxSend":
		var p FaxSendParams
		p.Port = 5060
		p.BaudRate = 9600
		p.Resolution = "standard"
		p.StationID = "SIPalyzer"
		json.Unmarshal(params, &p)
		result, err := RunFaxSend(p)
		return wrapResult(result, err, "FAX_ERROR", start)

	// PacketCapture is handled as a streaming command in connection.go
	// and is never dispatched through this synchronous path.

	case "DeviceScan":
		var p DeviceScanParams
		json.Unmarshal(params, &p)
		result, err := RunDeviceScan(p)
		return wrapResult(result, err, "DEVICE_SCAN_ERROR", start)

	case "SystemInfo":
		result, err := RunSystemInfo()
		return wrapResult(result, err, "SYSINFO_ERROR", start)

	case "DeviceControl":
		var p DeviceControlParams
		json.Unmarshal(params, &p)
		result, err := RunDeviceControl(p)
		return wrapResult(result, err, "DEVICE_CONTROL_ERROR", start)

	case "MulticastJoin":
		var p MulticastJoinParams
		json.Unmarshal(params, &p)
		result, err := RunMulticastJoin(p)
		return wrapResult(result, err, "MULTICAST_JOIN_ERROR", start)

	case "MulticastIgmpQuery":
		var p MulticastIgmpQueryParams
		json.Unmarshal(params, &p)
		result, err := RunMulticastIgmpQuery(p)
		return wrapResult(result, err, "MULTICAST_IGMP_ERROR", start)

	case "MulticastSnoopingVerify":
		var p MulticastSnoopingVerifyParams
		json.Unmarshal(params, &p)
		result, err := RunMulticastSnoopingVerify(p)
		return wrapResult(result, err, "MULTICAST_SNOOPING_ERROR", start)

	case "MulticastSendTest":
		var p MulticastSendTestParams
		p.Count = 10
		p.IntervalMs = 100
		p.TTL = 5
		json.Unmarshal(params, &p)
		result, err := RunMulticastSendTest(p)
		return wrapResult(result, err, "MULTICAST_SEND_ERROR", start)

	case "UpdateSchedule":
		var p UpdateScheduleParams
		json.Unmarshal(params, &p)
		result, err := RunUpdateSchedule(p)
		return wrapResult(result, err, "SCHEDULE_ERROR", start)

	case "FetchProvision":
		var p FetchProvisionParams
		json.Unmarshal(params, &p)
		result, err := RunFetchProvision(p)
		return wrapResult(result, err, "PROVISION_ERROR", start)

	default:
		log.Printf("[Agent] Unknown command: %s", command)
		return []ToolResponse{{
			Type: "Error",
			Data: ErrorData{Code: "UNKNOWN_COMMAND", Message: "Unknown command: " + command},
		}}
	}
}

func wrapResult(result interface{}, err error, code string, start time.Time) []ToolResponse {
	if err != nil {
		return []ToolResponse{{
			Type: "Error",
			Data: ErrorData{Code: code, Message: err.Error()},
		}}
	}
	return []ToolResponse{{
		Type: "Result",
		Data: ResultData{
			Success:   true,
			Result:    result,
			ElapsedMs: uint64(time.Since(start).Milliseconds()),
		},
	}}
}
