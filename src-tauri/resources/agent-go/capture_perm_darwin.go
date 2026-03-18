//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// probeBPFAccess checks whether the agent can open a /dev/bpf device.
func probeBPFAccess() CapturePermStatus {
	for i := 0; i < 4; i++ {
		f, err := os.OpenFile(fmt.Sprintf("/dev/bpf%d", i), os.O_RDONLY, 0)
		if err == nil {
			f.Close()
			return CapturePermStatus{Available: true, Method: "bpf", Detail: "BPF device accessible"}
		}
	}
	if path, err := exec.LookPath("dumpcap"); err == nil {
		return CapturePermStatus{Available: true, Method: "dumpcap", Detail: fmt.Sprintf("dumpcap at %s", path)}
	}
	if _, err := exec.LookPath("tcpdump"); err == nil {
		return CapturePermStatus{Available: true, Method: "tcpdump", Detail: "tcpdump available (may need privilege)"}
	}
	return CapturePermStatus{Available: false, Detail: "BPF not accessible, no dumpcap or tcpdump found"}
}

// requestCapturePermDarwin uses osascript to show the native macOS
// authentication dialog and grant BPF access for the current user.
func requestCapturePermDarwin() CapturePermStatus {
	script := `do shell script "chmod o+r /dev/bpf*" with administrator privileges with prompt "SIPalyzer Agent needs permission to capture network traffic."`
	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "User canceled") || strings.Contains(msg, "user canceled") {
			return CapturePermStatus{Available: false, Detail: "User cancelled the permission prompt"}
		}
		return CapturePermStatus{Available: false, Detail: fmt.Sprintf("Elevation failed: %s", msg)}
	}
	capturePermGranted.Store(true)
	return CapturePermStatus{Available: true, Method: "bpf_elevated", Detail: "BPF permissions granted via macOS dialog"}
}

func probeCapturePerm() CapturePermStatus {
	if capturePermGranted.Load() {
		return normalizeCapturePermStatus(CapturePermStatus{
			Available: true,
			Method:    "elevated",
			Detail:    "Permissions granted via elevation",
		})
	}
	return normalizeCapturePermStatus(probeBPFAccess())
}

func requestCapturePerm() CapturePermStatus {
	cur := probeCapturePerm()
	if cur.Available {
		return normalizeCapturePermStatus(cur)
	}
	return normalizeCapturePermStatus(requestCapturePermDarwin())
}
