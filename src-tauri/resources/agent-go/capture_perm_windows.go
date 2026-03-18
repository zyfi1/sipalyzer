//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

// probeWindowsRawSocket checks whether the agent can open a raw socket (requires admin)
// or if dumpcap (Wireshark/Npcap) is available.
func probeWindowsRawSocket() CapturePermStatus {
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, syscall.IPPROTO_IP)
	if err == nil {
		syscall.Closesocket(fd)
		return CapturePermStatus{Available: true, Method: "raw_socket", Detail: "Raw socket accessible (running as admin)"}
	}
	// Check for Wireshark's dumpcap
	for _, path := range []string{
		"dumpcap",
		`C:\Program Files\Wireshark\dumpcap.exe`,
		`C:\Program Files (x86)\Wireshark\dumpcap.exe`,
	} {
		if _, err := exec.LookPath(path); err == nil {
			return CapturePermStatus{Available: true, Method: "dumpcap", Detail: "dumpcap (Npcap) available"}
		}
	}
	return CapturePermStatus{Available: false, Detail: "Raw socket denied (needs Administrator) and Npcap not found"}
}

// requestCapturePermWindows tries to re-launch a helper command elevated via UAC.
// On Windows, the most reliable path is installing Npcap silently if available,
// or prompting the user to run as admin.
func requestCapturePermWindows() CapturePermStatus {
	// First check if dumpcap is already available (Npcap installed)
	for _, path := range []string{
		"dumpcap",
		`C:\Program Files\Wireshark\dumpcap.exe`,
		`C:\Program Files (x86)\Wireshark\dumpcap.exe`,
	} {
		if _, err := exec.LookPath(path); err == nil {
			capturePermGranted.Store(true)
			return CapturePermStatus{Available: true, Method: "dumpcap", Detail: "Npcap/dumpcap already available"}
		}
	}

	// Try UAC elevation: use powershell Start-Process with -Verb RunAs to run
	// a net session test. This triggers the UAC prompt.
	// If the user is already admin, this succeeds silently.
	cmd := exec.Command("powershell", "-Command",
		`Start-Process -FilePath 'cmd.exe' -ArgumentList '/c echo ok' -Verb RunAs -Wait -WindowStyle Hidden`)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return CapturePermStatus{
			Available: false,
			Detail:    fmt.Sprintf("UAC elevation failed: %s. Install Wireshark with Npcap for non-admin capture.", msg),
		}
	}

	return CapturePermStatus{
		Available: false,
		Detail:    fmt.Sprintf("UAC elevation succeeded but raw sockets require the agent to be restarted as Administrator, or install Npcap."),
	}
}

func probeCapturePerm() CapturePermStatus {
	if capturePermGranted.Load() {
		return normalizeCapturePermStatus(CapturePermStatus{
			Available: true,
			Method:    "elevated",
			Detail:    "Permissions granted via elevation",
		})
	}
	return normalizeCapturePermStatus(probeWindowsRawSocket())
}

func requestCapturePerm() CapturePermStatus {
	cur := probeCapturePerm()
	if cur.Available {
		return normalizeCapturePermStatus(cur)
	}
	return normalizeCapturePermStatus(requestCapturePermWindows())
}
