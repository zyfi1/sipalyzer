//go:build !linux && !darwin && !windows

package main

import "fmt"

func RunDeviceScan(p DeviceScanParams) (*DeviceScanResult, error) {
	return nil, fmt.Errorf("device scan not implemented on this platform")
}
