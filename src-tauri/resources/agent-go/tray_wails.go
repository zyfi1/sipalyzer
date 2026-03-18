//go:build !notray

package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed frontend
var frontendFS embed.FS

func RunTray(config *AgentConfig) {
	svc := NewAgentService(config)

	app := application.New(application.Options{
		Name: "SIPalyzer Agent",
		Mac: application.MacOptions{
			ActivationPolicy: application.ActivationPolicyAccessory,
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(frontendFS),
		},
		Services: []application.Service{
			application.NewService(svc),
		},
	})

	svc.quitFn = app.Quit

	shortID := config.AgentID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}

	// Full experience is a standalone GUI window (no systray).
	// Wails auto-discovers index.html inside the embedded FS and re-roots,
	// so the URL is just "/".
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Width:       860,
		Height:      760,
		MinWidth:    640,
		MinHeight:   520,
		Name:        fmt.Sprintf("SIPalyzer Agent (%s)", shortID),
		Frameless:   false,
		AlwaysOnTop: false,
		Hidden:      false,
		URL:         "/",
	})
	_ = window

	go func() {
		for !shutdown.Load() {
			time.Sleep(2 * time.Second)
			data := buildTrayData(config)
			app.Event.Emit("agent:status-update", data)
		}
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		shutdown.Store(true)
		cancelAllActiveSessions()
		app.Quit()
	}()

	if err := app.Run(); err != nil {
		log.Fatalf("[Agent] Wails app error: %v", err)
	}
}
