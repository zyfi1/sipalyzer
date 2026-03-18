package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/pion/stun/v3"
)

func RunStunTest(p StunTestParams) (*StunResult, error) {
	if p.Server == "" {
		p.Server = "stun.l.google.com:19302"
	}
	if !strings.Contains(p.Server, ":") {
		p.Server += ":3478"
	}
	uriStr := "stun:" + p.Server
	u, err := stun.ParseURI(uriStr)
	if err != nil {
		return nil, fmt.Errorf("parse stun uri: %w", err)
	}

	start := time.Now()
	c, err := stun.DialURI(u, &stun.DialConfig{})
	if err != nil {
		return nil, fmt.Errorf("dial stun %s: %w", p.Server, err)
	}
	defer c.Close()

	var publicIP string
	var publicPort uint16
	natType := "unknown"

	msg := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	err = c.Do(msg, func(res stun.Event) {
		if res.Error != nil {
			return
		}
		var mappedAddr stun.XORMappedAddress
		if err := mappedAddr.GetFrom(res.Message); err == nil {
			publicIP = mappedAddr.IP.String()
			publicPort = uint16(mappedAddr.Port)
			natType = "endpoint-independent"
		}
	})
	if err != nil {
		return nil, fmt.Errorf("stun request: %w", err)
	}
	elapsedMs := uint64(time.Since(start).Milliseconds())

	return &StunResult{
		Server:     p.Server,
		PublicIP:   publicIP,
		PublicPort: publicPort,
		NatType:    natType,
		ElapsedMs:  elapsedMs,
	}, nil
}
