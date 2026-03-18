//go:build darwin

package main

import (
	"log"
	"os/exec"
	"syscall"
)

func scheduleAppBundleRemoval(appPath string) {
	// Retry a few times in case Finder / launch services still has handles briefly.
	cmd := exec.Command("sh", "-c",
		"for i in 1 2 3 4 5 6 7 8 9 10; do rm -rf "+quoteForShell(appPath)+" 2>/dev/null; [ ! -e "+quoteForShell(appPath)+" ] && exit 0; sleep 1; done")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		log.Printf("[SelfDestruct] Failed to spawn bundle removal: %v", err)
	}
}
