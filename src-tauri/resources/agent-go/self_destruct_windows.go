//go:build windows

package main

import (
	"log"
	"os/exec"
	"strings"
	"syscall"
)

const createNoWindow = 0x08000000 // CREATE_NO_WINDOW

func performSelfDestructWindows(exe string) {
	// Windows cannot delete a running executable immediately. Spawn a detached
	// cleanup loop that retries deletion for up to ~30 seconds.
	log.Printf("[SelfDestruct] Scheduling binary removal (Windows): %s", exe)
	escaped := strings.ReplaceAll(exe, `"`, `""`)
	script := `set "__SIP_EXE=` + escaped + `" && ` +
		`for /l %%i in (1,1,30) do (` +
		`del /f /q "%__SIP_EXE%" >nul 2>nul && if not exist "%__SIP_EXE%" goto :done` +
		`) & timeout /t 1 /nobreak >nul ` +
		`& :done`
	cmd := exec.Command("cmd.exe", "/C", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	if err := cmd.Start(); err != nil {
		log.Printf("[SelfDestruct] Failed to spawn delete process: %v", err)
	}
}
