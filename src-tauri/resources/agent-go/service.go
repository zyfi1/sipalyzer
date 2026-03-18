//go:build !notray

package main

// AgentService exposes agent state and actions to the Wails frontend.
type AgentService struct {
	config *AgentConfig
	quitFn func() // set by RunTray after app creation
}

func NewAgentService(config *AgentConfig) *AgentService {
	return &AgentService{config: config}
}

func (s *AgentService) GetStatus() TrayData {
	return buildTrayData(s.config)
}

func (s *AgentService) Reconnect() {
	TriggerReconnect()
}

func (s *AgentService) Quit() {
	shutdown.Store(true)
	cancelAllActiveSessions()
	if s.quitFn != nil {
		s.quitFn()
	}
}

func (s *AgentService) GetHistory() []TaskHistoryEntry {
	return getTaskHistory()
}

func (s *AgentService) GetChat() []TrayChatMessage {
	return getTrayChatMessages()
}

func (s *AgentService) SendChat(text string) {
	if text == "" {
		return
	}
	addTrayChatMessage("remote", text, false)
	queueOutboundChat(text, "remote")
}

func (s *AgentService) MarkChatRead() {
	markTrayChatRead()
}
