package main

import (
	"encoding/json"
	"os"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Compile-time config injection via -ldflags -X main.varName=value
// When these are set, the agent is fully self-contained — no agent.json needed.
// ---------------------------------------------------------------------------

var (
	embeddedAgentID           string // -X main.embeddedAgentID=...
	embeddedControllerAddress string // -X main.embeddedControllerAddress=...
	embeddedAuthToken         string // -X main.embeddedAuthToken=...
	embeddedUseTLS            string // -X main.embeddedUseTLS=true|false
	embeddedExpiresAt         string // -X main.embeddedExpiresAt=<RFC3339>
	embeddedLabel             string // -X main.embeddedLabel=...
	embeddedControllerName    string // -X main.embeddedControllerName=...
	embeddedAgentProfile      string // Runtime experience profile: "minimal" or "full"
)

// AgentConfig is the configuration for a remote agent instance.
type AgentConfig struct {
	AgentID           string     `json:"agent_id"`
	ControllerAddress string     `json:"controller_address"`
	UseTLS            bool       `json:"use_tls"`
	AuthToken         string     `json:"auth_token"`
	ExpiresAt         *time.Time `json:"expires_at"`
	Label             *string    `json:"label"`
	ControllerName    *string    `json:"controller_name"`
}

// HasEmbeddedConfig returns true if config was baked into the binary at compile time.
func HasEmbeddedConfig() bool {
	return embeddedAgentID != ""
}

// LoadEmbeddedConfig builds an AgentConfig from compile-time -ldflags values.
func LoadEmbeddedConfig() (*AgentConfig, error) {
	cfg := &AgentConfig{
		AgentID:           embeddedAgentID,
		ControllerAddress: embeddedControllerAddress,
		AuthToken:         embeddedAuthToken,
		UseTLS:            embeddedUseTLS != "false", // default true
	}

	// Parse expiration timestamp
	if embeddedExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, embeddedExpiresAt)
		if err == nil {
			cfg.ExpiresAt = &t
		}
	}

	if embeddedLabel != "" {
		cfg.Label = &embeddedLabel
	}

	if embeddedControllerName != "" {
		cfg.ControllerName = &embeddedControllerName
	}

	return cfg, nil
}

// LoadConfigFromFile reads and parses agent.json from the given path.
func LoadConfigFromFile(path string) (*AgentConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg AgentConfig
	cfg.UseTLS = true // default
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// IsExpired checks whether the config has passed its expiration time.
func (c *AgentConfig) IsExpired() bool {
	if c.ExpiresAt == nil {
		return false
	}
	return time.Now().UTC().After(*c.ExpiresAt)
}

// TimeUntilExpiry returns the duration until the agent expires, or -1 if it never expires.
func (c *AgentConfig) TimeUntilExpiry() time.Duration {
	if c.ExpiresAt == nil {
		return -1
	}
	d := time.Until(*c.ExpiresAt)
	if d < 0 {
		return 0
	}
	return d
}

// ControllerCandidates returns an ordered, de-duplicated list of controller
// addresses. Backward-compatible with the legacy single `controller_address`.
//
// Multi-endpoint format (optional): "addr1|addr2|addr3"
// - addr can be direct host:port, [ipv6]:port, or relay.host/session/{id}
func (c *AgentConfig) ControllerCandidates() []string {
	raw := strings.TrimSpace(c.ControllerAddress)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, "|")
	seen := make(map[string]struct{}, len(parts))
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		addr := strings.TrimSpace(p)
		if addr == "" {
			continue
		}
		if _, ok := seen[addr]; ok {
			continue
		}
		seen[addr] = struct{}{}
		out = append(out, addr)
	}
	if len(out) == 0 {
		return []string{raw}
	}
	return out
}
