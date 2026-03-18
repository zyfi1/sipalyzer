//go:build !windows && !linux && !(darwin && cgo)

package main

import (
	"fmt"
	"os"
)

func openPty() (master, slave *os.File, err error) {
	return nil, nil, fmt.Errorf("PTY not available (CGo required on this platform)")
}

func setPtySize(_ uintptr, _, _ uint16) error {
	return fmt.Errorf("PTY not available (CGo required on this platform)")
}
