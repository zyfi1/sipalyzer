package main

import "sync/atomic"

// capturePermGranted is set to true after a successful RequestCapturePerm elevation.
var capturePermGranted atomic.Bool

// agentProfile is embedded at build time via ldflags and controls frontend UX.
// Supported values: "minimal", "full".
func agentProfile() string {
	switch embeddedAgentProfile {
	case "minimal", "full":
		return embeddedAgentProfile
	default:
		return "full"
	}
}

// agentCapabilities returns the list of tool capabilities this agent supports.
// PacketCapture is always included. Use probeCapturePerm() to check if
// capture will actually work at the OS level without elevation.
func agentCapabilities() []string {
	return []string{
		"Ping",
		"Traceroute",
		"Mtr",
		"DnsLookup",
		"DnsSipResolve",
		"DnsReverse",
		"DnsDig",
		"DnsGeoIp",
		"PortScan",
		"SipRegistrationTest",
		"SipProbe",
		"SipCall",
		"StunTest",
		"NtpCheck",
		"NatDetect",
		"SnmpPoll",
		"FaxSend",
		"DeviceScan",
		"SystemInfo",
		"PacketCapture",
		"SyslogListen",
		"FetchLog",
		"TailLog",
		"FileServe",
		"ListDir",
		"Shell",
		"DeviceControl",
		"FirmwareDownload",
		"MulticastJoin",
		"MulticastIgmpQuery",
		"MulticastSnoopingVerify",
		"MulticastSendTest",
		"FetchProvision",
		"ChatMessage",
	}
}

// CapturePermStatus describes whether raw packet capture is available right now.
type CapturePermStatus struct {
	Available bool   `json:"available"`
	Method    string `json:"method,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

func normalizeCapturePermStatus(status CapturePermStatus) CapturePermStatus {
	switch status.Method {
	case "bpf", "af_packet", "raw_socket":
		status.Method = "native"
	case "bpf_elevated", "setcap_elevated":
		status.Method = "elevated"
	}

	if status.Available && status.Method == "" {
		status.Method = "native"
	}
	if !status.Available && status.Detail == "" {
		status.Detail = "Capture permission is required"
	}
	return status
}

// probeCapturePerm is defined per-platform in capture_perm_{darwin,linux,windows,stub}.go
