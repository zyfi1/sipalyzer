package main

import (
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// PerformSelfDestruct deletes the config file and the running executable.
// On macOS it also removes the .app bundle if applicable.
// On Windows it spawns a detached process that waits then deletes the binary.
func PerformSelfDestruct() {
	exe, err := os.Executable()
	if err != nil {
		log.Printf("[SelfDestruct] Cannot determine executable path: %v", err)
		return
	}
	exeDir := filepath.Dir(exe)
	configPath := filepath.Join(exeDir, "agent.json")

	// Delete config file first
	if err := os.Remove(configPath); err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[SelfDestruct] Failed to remove config %s: %v", configPath, err)
		}
	} else {
		log.Printf("[SelfDestruct] Removed config: %s", configPath)
	}

	switch runtime.GOOS {
	case "windows":
		performSelfDestructWindows(exe)
	default:
		// Unix (Linux, macOS, etc.) - can delete running binary directly
		log.Printf("[SelfDestruct] Removing binary: %s", exe)
		if err := os.Remove(exe); err != nil {
			log.Printf("[SelfDestruct] Failed to remove binary: %v", err)
		}
		// On macOS, check for .app bundle and schedule its removal
		if runtime.GOOS == "darwin" {
			if idx := strings.Index(exe, ".app/Contents/MacOS/"); idx != -1 {
				appPath := exe[:idx+4] // include ".app"
				log.Printf("[SelfDestruct] Detected .app bundle, scheduling removal: %s", appPath)
				scheduleAppBundleRemoval(appPath)
			}
		}
	}
}

func quoteForShell(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "'\"'\"'") + "'"
}
