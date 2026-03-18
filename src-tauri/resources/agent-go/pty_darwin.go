//go:build darwin && cgo

package main

/*
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>

int c_posix_openpt(int flags) { return posix_openpt(flags); }
int c_grantpt(int fd)         { return grantpt(fd); }
int c_unlockpt(int fd)        { return unlockpt(fd); }

// ptsname_r is not available on macOS; use ptsname (thread-safe on Darwin).
const char* c_ptsname(int fd) { return ptsname(fd); }
*/
import "C"

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func openPty() (master, slave *os.File, err error) {
	fd := C.c_posix_openpt(C.O_RDWR | C.O_NOCTTY)
	if fd < 0 {
		return nil, nil, fmt.Errorf("posix_openpt failed")
	}
	master = os.NewFile(uintptr(fd), "/dev/ptmx")

	if C.c_grantpt(fd) != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("grantpt failed")
	}
	if C.c_unlockpt(fd) != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("unlockpt failed")
	}

	cname := C.c_ptsname(fd)
	if cname == nil {
		master.Close()
		return nil, nil, fmt.Errorf("ptsname returned nil")
	}
	slavePath := C.GoString(cname)

	slave, err = os.OpenFile(slavePath, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		master.Close()
		return nil, nil, fmt.Errorf("open slave %s: %w", slavePath, err)
	}
	return master, slave, nil
}

func setPtySize(fd uintptr, cols, rows uint16) error {
	ws := struct {
		Row, Col, X, Y uint16
	}{Row: rows, Col: cols}
	// TIOCSWINSZ on macOS = 0x80087467
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, 0x80087467, uintptr(unsafe.Pointer(&ws))); errno != 0 {
		return fmt.Errorf("TIOCSWINSZ: %v", errno)
	}
	return nil
}
