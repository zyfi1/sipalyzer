//go:build notray

package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
)

// RunTray blocks the main goroutine and waits for a shutdown signal.
// In notray builds:
// - minimal: headless runtime only
// - full: local GUI served over localhost and opened in the default browser
func RunTray(config *AgentConfig) {
	var stopWebUI func()
	if agentProfile() == "full" {
		var url string
		var err error
		stopWebUI, url, err = startLocalWebUI(config)
		if err != nil {
			log.Printf("[Agent] Local GUI failed to start: %v", err)
		} else {
			log.Printf("[Agent] Local GUI available at %s", url)
			if err := openInDefaultBrowser(url); err != nil {
				log.Printf("[Agent] Failed to open browser automatically: %v", err)
			}
		}
	}
	if stopWebUI != nil {
		defer stopWebUI()
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	log.Println("[Agent] Running (send SIGINT/SIGTERM to stop)...")

	select {
	case sig := <-sigCh:
		log.Printf("[Agent] Received signal %v, shutting down...", sig)
		shutdown.Store(true)
	}
}
