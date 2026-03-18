//go:build !darwin && !linux && !windows

package main

func probeCapturePerm() CapturePermStatus {
	return normalizeCapturePermStatus(CapturePermStatus{
		Available: false,
		Detail:    "Unsupported platform",
	})
}

func requestCapturePerm() CapturePermStatus {
	return normalizeCapturePermStatus(CapturePermStatus{
		Available: false,
		Detail:    "Permission elevation not supported on this platform",
	})
}
