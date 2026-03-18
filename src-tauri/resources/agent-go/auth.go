package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

const ProtocolVersion = 1

// AuthChallenge is sent by the controller to the agent.
type AuthChallenge struct {
	Nonce           string `json:"nonce"`
	ProtocolVersion uint32 `json:"protocol_version"`
}

// AuthResponse is sent by the agent back to the controller.
type AuthResponse struct {
	AgentID         string   `json:"agent_id"`
	HMAC            string   `json:"hmac"`
	ProtocolVersion uint32   `json:"protocol_version"`
	Profile         string   `json:"profile"`
	Capabilities    []string `json:"capabilities"`
}

// ComputeHMAC calculates HMAC-SHA256(key=token, msg=nonce) and returns hex.
func ComputeHMAC(nonce, token string) string {
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(nonce))
	return hex.EncodeToString(mac.Sum(nil))
}
