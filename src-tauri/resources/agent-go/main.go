package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

var (
	shutdown        atomic.Bool
	connectionUp    atomic.Bool  // true when authenticated & connected to controller
	lastConnectedAt atomic.Value // stores time.Time of last successful connection
	activeTask      atomic.Value // stores string: current running command label ("" = idle)
	connStatus      atomic.Value // stores string: "connected", "connecting", "waiting:<duration>"
	agentIDShort    string       // first 8 chars of agent ID, set once at startup
	startTime       = time.Now()
	reconnectCh     = make(chan struct{}, 1) // non-blocking trigger for immediate reconnect
)

func setConnStatus(s string)  { connStatus.Store(s) }
func getConnStatus() string {
	v := connStatus.Load()
	if v == nil {
		return "connecting"
	}
	return v.(string)
}

// TriggerReconnect signals the connection loop to skip the backoff sleep
// and reconnect immediately. Safe to call from any goroutine.
func TriggerReconnect() {
	select {
	case reconnectCh <- struct{}{}:
	default:
	}
}

// setActiveTask updates the tray tooltip with the currently running command.
func setActiveTask(label string) { activeTask.Store(label) }

// getActiveTask returns the current running command label, or "".
func getActiveTask() string {
	v := activeTask.Load()
	if v == nil {
		return ""
	}
	return v.(string)
}

// ── Task history ring buffer ────────────────────────────────────────────

// TaskHistoryEntry records a completed tool execution for the tray display.
type TaskHistoryEntry struct {
	Label     string        `json:"label"`
	Success   bool          `json:"success"`
	ElapsedMs int64         `json:"elapsed_ms"`
	Completed time.Time     `json:"completed"`
}

const taskHistorySize = 5
const trayChatHistorySize = 100

var (
	taskHistory    [taskHistorySize]TaskHistoryEntry
	taskHistoryLen int
	taskHistoryMu  sync.Mutex
	chatHistory    []TrayChatMessage
	chatHistoryMu  sync.Mutex
)

type TrayChatMessage struct {
	ID        string `json:"id"`
	Sender    string `json:"sender"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
	Unread    bool   `json:"unread"`
}

func addTrayChatMessage(sender, text string, unread bool) TrayChatMessage {
	msg := TrayChatMessage{
		ID:        generateID(),
		Sender:    sender,
		Text:      text,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Unread:    unread,
	}
	chatHistoryMu.Lock()
	defer chatHistoryMu.Unlock()
	chatHistory = append(chatHistory, msg)
	if len(chatHistory) > trayChatHistorySize {
		chatHistory = chatHistory[len(chatHistory)-trayChatHistorySize:]
	}
	return msg
}

func getTrayChatMessages() []TrayChatMessage {
	chatHistoryMu.Lock()
	defer chatHistoryMu.Unlock()
	out := make([]TrayChatMessage, len(chatHistory))
	copy(out, chatHistory)
	return out
}

func markTrayChatRead() {
	chatHistoryMu.Lock()
	defer chatHistoryMu.Unlock()
	for i := range chatHistory {
		chatHistory[i].Unread = false
	}
}

func trayChatUnreadCount() int {
	chatHistoryMu.Lock()
	defer chatHistoryMu.Unlock()
	count := 0
	for _, m := range chatHistory {
		if m.Unread {
			count++
		}
	}
	return count
}

func lastTrayChatSnippet() string {
	chatHistoryMu.Lock()
	defer chatHistoryMu.Unlock()
	if len(chatHistory) == 0 {
		return "No chat messages"
	}
	last := chatHistory[len(chatHistory)-1]
	msg := last.Text
	runes := []rune(msg)
	if len(runes) > 36 {
		msg = string(runes[:36]) + "..."
	}
	return fmt.Sprintf("%s: %s", last.Sender, msg)
}

// addTaskHistory records a completed task into the ring buffer.
func addTaskHistory(label string, success bool, elapsed time.Duration) {
	taskHistoryMu.Lock()
	defer taskHistoryMu.Unlock()
	// Shift older entries down, newest at index 0
	if taskHistoryLen < taskHistorySize {
		taskHistoryLen++
	}
	for i := taskHistoryLen - 1; i > 0; i-- {
		taskHistory[i] = taskHistory[i-1]
	}
	taskHistory[0] = TaskHistoryEntry{
		Label:     label,
		Success:   success,
		ElapsedMs: elapsed.Milliseconds(),
		Completed: time.Now(),
	}
}

// getTaskHistory returns up to taskHistorySize recent tasks, newest first.
func getTaskHistory() []TaskHistoryEntry {
	taskHistoryMu.Lock()
	defer taskHistoryMu.Unlock()
	result := make([]TaskHistoryEntry, taskHistoryLen)
	copy(result, taskHistory[:taskHistoryLen])
	return result
}

// ── TrayData: shared state snapshot for all platform tray UIs ───────────

// TrayData is the full snapshot of agent state that tray UIs render.
type TrayData struct {
	Hostname       string             `json:"hostname"`
	AgentID        string             `json:"agent_id"`
	LocalIP        string             `json:"local_ip"`
	Controller     string             `json:"controller"`
	ControllerName string             `json:"controller_name"`
	Connected      bool               `json:"connected"`
	ConnStatus     string             `json:"conn_status"`
	Uptime         string             `json:"uptime"`
	ExpiresIn      string             `json:"expires_in"`
	CaptureStatus  CapturePermStatus  `json:"capture_status"`
	CurrentTask    string             `json:"current_task"`
	RecentTasks    []TaskHistoryEntry `json:"recent_tasks"`
	ChatUnread     int                `json:"chat_unread"`
	LastChatSnippet string            `json:"last_chat_snippet"`
	ChatMessages   []TrayChatMessage  `json:"chat_messages"`
}

// buildTrayData assembles a snapshot of current agent state for the tray UI.
func buildTrayData(config *AgentConfig) TrayData {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	truncID := config.AgentID
	if len(truncID) > 8 {
		truncID = truncID[:8]
	}

	expiresIn := "Never"
	if config.ExpiresAt != nil {
		ttl := config.TimeUntilExpiry()
		if ttl <= 0 {
			expiresIn = "Expired"
		} else {
			expiresIn = fmtUptime(ttl)
		}
	}

	ctrlName := "SIPalyzer"
	if embeddedControllerName != "" {
		ctrlName = embeddedControllerName
	}

	task := getActiveTask()
	if task == "" {
		task = "Idle"
	}

	cs := getConnStatus()
	return TrayData{
		Hostname:       hostname,
		AgentID:        truncID,
		LocalIP:        getLocalIP(),
		Controller:     config.ControllerAddress,
		ControllerName: ctrlName,
		Connected:      cs == "connected",
		ConnStatus:     cs,
		Uptime:         fmtUptime(time.Since(startTime)),
		ExpiresIn:      expiresIn,
		CaptureStatus:  probeCapturePerm(),
		CurrentTask:    task,
		RecentTasks:    getTaskHistory(),
		ChatUnread:     trayChatUnreadCount(),
		LastChatSnippet: lastTrayChatSnippet(),
		ChatMessages:   getTrayChatMessages(),
	}
}

// trayDataJSON returns the TrayData as a JSON string.
func trayDataJSON(config *AgentConfig) string {
	data := buildTrayData(config)
	b, _ := json.Marshal(data)
	return string(b)
}

// fmtUptime formats a duration for tray display.
func fmtUptime(d time.Duration) string {
	d = d.Round(time.Second)
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	switch {
	case h > 24:
		return fmt.Sprintf("%dd %dh %dm", h/24, h%24, m)
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	case m > 0:
		return fmt.Sprintf("%dm %ds", m, s)
	default:
		return fmt.Sprintf("%ds", s)
	}
}

func main() {
	configPath := flag.String("config", "", "Path to agent.json config file (optional if config is built-in)")
	flag.Parse()

	var config *AgentConfig
	var err error

	// Try embedded config first (baked in at compile time via -ldflags)
	if HasEmbeddedConfig() {
		config, err = LoadEmbeddedConfig()
		if err != nil {
			fmt.Fprintf(os.Stderr, "[SIPalyzer Agent] Failed to load embedded config: %v\n", err)
			os.Exit(1)
		}
		log.Println("[SIPalyzer Agent] Using built-in configuration.")
	} else {
		// Fall back to agent.json file
		cfgPath := *configPath
		if cfgPath == "" {
			exe, err := os.Executable()
			if err != nil {
				log.Fatal("[Agent] Cannot determine executable path:", err)
			}
			cfgPath = filepath.Join(filepath.Dir(exe), "agent.json")
		}

		config, err = LoadConfigFromFile(cfgPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[SIPalyzer Agent] Failed to load config from %s: %v\n", cfgPath, err)
			fmt.Fprintln(os.Stderr, "[SIPalyzer Agent] No built-in config and no agent.json found.")
			os.Exit(1)
		}
		log.Printf("[SIPalyzer Agent] Loaded config from file.")
	}

	// Store short agent ID for UA string
	agentIDShort = config.AgentID
	if len(agentIDShort) > 8 {
		agentIDShort = agentIDShort[:8]
	}

	// Check expiration
	if config.IsExpired() {
		log.Println("[SIPalyzer Agent] This agent has expired. Self-destructing.")
		PerformSelfDestruct()
		os.Exit(0)
	}

	log.Printf("[SIPalyzer Agent] Agent ID: %s", config.AgentID)
	log.Printf("[SIPalyzer Agent] Controller: %s", config.ControllerAddress)

	if ttl := config.TimeUntilExpiry(); ttl >= 0 {
		log.Printf("[SIPalyzer Agent] Expires in %s", fmtDuration(ttl))
	} else {
		log.Println("[SIPalyzer Agent] No expiration set — runs indefinitely.")
	}

	// Start expiration watchdog (checks periodically and self-destructs when expired)
	go runExpirationWatchdog(config)

	// Start connection loop in a goroutine
	go RunConnectionLoop(config)

	// Block main thread with signal handler
	RunTray(config)
}

// runExpirationWatchdog periodically checks if the agent has expired.
// When expired, it performs self-destruct (removes the binary) and exits.
func runExpirationWatchdog(config *AgentConfig) {
	if config.ExpiresAt == nil {
		return // No expiration — nothing to watch
	}

	for {
		if shutdown.Load() {
			return
		}

		ttl := config.TimeUntilExpiry()
		if ttl <= 0 {
			log.Println("[Agent] Expiration reached. Self-destructing...")
			shutdown.Store(true)
			PerformSelfDestruct()
			os.Exit(0)
		}

		// Sleep for a reasonable interval: check more frequently as expiration approaches
		var sleepDur time.Duration
		switch {
		case ttl > 24*time.Hour:
			sleepDur = 1 * time.Hour
		case ttl > 1*time.Hour:
			sleepDur = 10 * time.Minute
		case ttl > 10*time.Minute:
			sleepDur = 1 * time.Minute
		default:
			sleepDur = 10 * time.Second
		}
		time.Sleep(sleepDur)
	}
}

// fmtDuration formats a duration in a human-readable way.
func fmtDuration(d time.Duration) string {
	d = d.Round(time.Second)
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}
