//go:build linux

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func openPty() (master, slave *os.File, err error) {
	m, err := syscall.Open("/dev/ptmx", syscall.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open /dev/ptmx: %w", err)
	}
	master = os.NewFile(uintptr(m), "/dev/ptmx")

	// unlockpt via TIOCSPTLCK
	var unlock int32
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(m), 0x40045431, uintptr(unsafe.Pointer(&unlock))); errno != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("TIOCSPTLCK: %v", errno)
	}

	// ptsname via TIOCGPTN
	var n int32
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(m), 0x80045430, uintptr(unsafe.Pointer(&n))); errno != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("TIOCGPTN: %v", errno)
	}
	slavePath := fmt.Sprintf("/dev/pts/%d", n)

	slave, err = os.OpenFile(slavePath, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		master.Close()
		return nil, nil, err
	}
	return master, slave, nil
}

func setPtySize(fd uintptr, cols, rows uint16) error {
	ws := struct {
		Row, Col, X, Y uint16
	}{Row: rows, Col: cols}
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, 0x5414, uintptr(unsafe.Pointer(&ws))); errno != 0 {
		return fmt.Errorf("TIOCSWINSZ: %v", errno)
	}
	return nil
}
