//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"golang.org/x/sys/unix"
)

// probeAFPacket checks whether the agent can open an AF_PACKET raw socket.
func probeAFPacket() CapturePermStatus {
	fd, err := unix.Socket(unix.AF_PACKET, unix.SOCK_RAW, 0x0300)
	if err == nil {
		unix.Close(fd)
		return CapturePermStatus{Available: true, Method: "af_packet", Detail: "AF_PACKET raw socket accessible"}
	}
	if path, err := exec.LookPath("dumpcap"); err == nil {
		return CapturePermStatus{Available: true, Method: "dumpcap", Detail: fmt.Sprintf("dumpcap at %s", path)}
	}
	if _, err := exec.LookPath("tcpdump"); err == nil {
		return CapturePermStatus{Available: true, Method: "tcpdump", Detail: "tcpdump available (may need privilege)"}
	}
	return CapturePermStatus{Available: false, Detail: "AF_PACKET denied (needs CAP_NET_RAW), no dumpcap or tcpdump"}
}

// requestCapturePermLinux tries pkexec (GUI PolicyKit dialog) first, then
// falls back to printing instructions.
func requestCapturePermLinux() CapturePermStatus {
	agentPath, err := os.Executable()
	if err != nil {
		return CapturePermStatus{Available: false, Detail: fmt.Sprintf("Cannot determine binary path: %s", err)}
	}

	// Try pkexec (graphical sudo) to set CAP_NET_RAW on the agent binary
	if pkexecPath, err := exec.LookPath("pkexec"); err == nil {
		cmd := exec.Command(pkexecPath, "setcap", "cap_net_raw+eip", agentPath)
		out, err := cmd.CombinedOutput()
		if err == nil {
			capturePermGranted.Store(true)
			return CapturePermStatus{Available: true, Method: "setcap_elevated", Detail: "CAP_NET_RAW granted via pkexec"}
		}
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "dismissed") || strings.Contains(msg, "Not authorized") {
			return CapturePermStatus{Available: false, Detail: "User cancelled the permission prompt"}
		}
		return CapturePermStatus{Available: false, Detail: fmt.Sprintf("pkexec setcap failed: %s", msg)}
	}

	return CapturePermStatus{
		Available: false,
		Detail:    fmt.Sprintf("No GUI elevation available. Run manually: sudo setcap cap_net_raw+eip %s", agentPath),
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
	return normalizeCapturePermStatus(probeAFPacket())
}

func requestCapturePerm() CapturePermStatus {
	cur := probeCapturePerm()
	if cur.Available {
		return normalizeCapturePermStatus(cur)
	}
	return normalizeCapturePermStatus(requestCapturePermLinux())
}
