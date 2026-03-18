package main

import (
	"context"
	"fmt"
	"math"
	"net"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

type hopStats struct {
	mu       sync.Mutex
	ip       string
	hostname string
	sent     uint32
	received uint32
	rtts     []float64
	lastMs   float64
}

// RunMtrStream runs repeated traceroutes and emits per-round Progress updates via ch.
// The final Result is the accumulated stats.
func RunMtrStream(ctx context.Context, p MtrParams, ch chan<- ToolResponse) {
	defer close(ch)

	if p.Host == "" {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "MTR_ERROR", Message: "host is required"}}
		return
	}
	if p.MaxHops == 0 {
		p.MaxHops = 30
	}
	if p.Rounds == 0 {
		p.Rounds = 20
	}
	if p.IntervalMs == 0 {
		p.IntervalMs = 1000
	}
	if p.TimeoutMs == 0 {
		p.TimeoutMs = 2000
	}

	destIP, err := net.ResolveIPAddr("ip4", p.Host)
	if err != nil {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "MTR_ERROR", Message: fmt.Sprintf("resolve: %v", err)}}
		return
	}
	dest := destIP.IP.To4()
	if dest == nil {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "MTR_ERROR", Message: "IPv6 not supported"}}
		return
	}

	timeout := time.Duration(p.TimeoutMs) * time.Millisecond

	hops := make([]*hopStats, p.MaxHops)
	for i := range hops {
		hops[i] = &hopStats{}
	}

	// rDNS cache to avoid repeated lookups
	rdnsCache := sync.Map{}
	resolveHost := func(ip string) string {
		if v, ok := rdnsCache.Load(ip); ok {
			return v.(string)
		}
		names, err := net.LookupAddr(ip)
		name := ""
		if err == nil && len(names) > 0 {
			name = strings.TrimSuffix(names[0], ".")
		}
		rdnsCache.Store(ip, name)
		return name
	}

	maxHopSeen := uint8(0)

	for round := uint32(1); round <= p.Rounds; round++ {
		if ctx.Err() != nil {
			break
		}

		// Open ICMP listener for this round
		conn, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
		if err != nil {
			ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "MTR_ERROR", Message: fmt.Sprintf("icmp listen: %v", err)}}
			return
		}

		reached := false
		for ttl := uint8(1); ttl <= p.MaxHops && !reached; ttl++ {
			if ctx.Err() != nil {
				break
			}
			start := time.Now()
			h := hops[ttl-1]
			h.mu.Lock()
			h.sent++
			h.mu.Unlock()

			fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, syscall.IPPROTO_UDP)
			if err != nil {
				continue
			}
			_ = syscall.SetsockoptInt(fd, syscall.IPPROTO_IP, syscall.IP_TTL, int(ttl))
			destSock := syscall.SockaddrInet4{Port: traceroutePort, Addr: [4]byte{dest[0], dest[1], dest[2], dest[3]}}
			_ = syscall.Sendto(fd, []byte{0}, 0, &destSock)
			syscall.Close(fd)

			conn.SetReadDeadline(time.Now().Add(timeout))
			buf := make([]byte, 1500)
			n, from, recvErr := conn.ReadFrom(buf)
			rtt := float64(time.Since(start).Microseconds()) / 1000.0

			if recvErr != nil {
				continue
			}
			msg, err := icmp.ParseMessage(1, buf[:n])
			if err != nil {
				continue
			}

			var fromIP string
			if a, ok := from.(*net.IPAddr); ok {
				fromIP = a.IP.String()
			}

			h.mu.Lock()
			h.received++
			h.rtts = append(h.rtts, rtt)
			h.lastMs = rtt
			if h.ip == "" {
				h.ip = fromIP
				h.hostname = resolveHost(fromIP)
			}
			h.mu.Unlock()

			if ttl > maxHopSeen {
				maxHopSeen = ttl
			}

			switch msg.Type {
			case ipv4.ICMPTypeDestinationUnreachable:
				reached = true
			}
		}

		conn.Close()

		// Emit progress with current stats
		snapshot := buildMtrSnapshot(hops, maxHopSeen)
		pct := float64(round) / float64(p.Rounds)
		ch <- ToolResponse{
			Type: "Progress",
			Data: ProgressData{
				Progress: &pct,
				Message:  fmt.Sprintf("Round %d/%d", round, p.Rounds),
				Partial:  snapshot,
			},
		}

		if round < p.Rounds {
			select {
			case <-ctx.Done():
			case <-time.After(time.Duration(p.IntervalMs) * time.Millisecond):
			}
		}
	}

	// Final result
	finalHops := buildMtrSnapshot(hops, maxHopSeen)
	ch <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: MtrResult{
				Host:       p.Host,
				ResolvedIP: destIP.String(),
				Hops:       finalHops,
				Rounds:     p.Rounds,
			},
		},
	}
}

func buildMtrSnapshot(hops []*hopStats, maxHop uint8) []MtrHop {
	result := make([]MtrHop, 0, maxHop)
	for i := uint8(0); i < maxHop; i++ {
		h := hops[i]
		h.mu.Lock()
		mh := MtrHop{
			Hop:      i + 1,
			IP:       h.ip,
			Hostname: h.hostname,
			Sent:     h.sent,
			Received: h.received,
			LastMs:   h.lastMs,
		}
		if h.sent > 0 {
			mh.LossPct = float64(h.sent-h.received) / float64(h.sent) * 100.0
		}
		if len(h.rtts) > 0 {
			var sum, min, max float64
			min = h.rtts[0]
			max = h.rtts[0]
			for _, r := range h.rtts {
				sum += r
				if r < min {
					min = r
				}
				if r > max {
					max = r
				}
			}
			avg := sum / float64(len(h.rtts))
			mh.AvgMs = avg
			mh.BestMs = min
			mh.WorstMs = max

			// Standard deviation
			var variance float64
			for _, r := range h.rtts {
				d := r - avg
				variance += d * d
			}
			mh.StdevMs = math.Sqrt(variance / float64(len(h.rtts)))

			// Jitter (mean of consecutive differences)
			if len(h.rtts) > 1 {
				var jitterSum float64
				for j := 1; j < len(h.rtts); j++ {
					d := h.rtts[j] - h.rtts[j-1]
					if d < 0 {
						d = -d
					}
					jitterSum += d
				}
				mh.JitterMs = jitterSum / float64(len(h.rtts)-1)
			}
		}
		h.mu.Unlock()
		result = append(result, mh)
	}
	return result
}
