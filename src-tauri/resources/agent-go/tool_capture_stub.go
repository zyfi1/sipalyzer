//go:build !darwin && !linux && !windows

package main

import "context"

// RunPacketCaptureStream is the stub for unsupported platforms.
func RunPacketCaptureStream(_ context.Context, p PacketCaptureParams, out chan<- ToolResponse) {
	defer close(out)
	out <- ToolResponse{
		Type: "Error",
		Data: ErrorData{
			Code:    "CAPTURE_ERROR",
			Message: "packet capture is not supported on this platform",
		},
	}
}
