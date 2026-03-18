package main

import (
	"fmt"
	"time"
)

// T.30 over T.38 IFP (Internet Facsimile Protocol)
//
// T.38 IFP message types:
//   Type 0: T30_INDICATOR  (CNG, CED, V.21 preamble, training, etc.)
//   Type 1: T30_DATA       (V.21 HDLC data for control, high-speed data)
//
// T.30 HDLC frames (sent as V.21 HDLC):
//   DIS (0x80, 0x01) - Digital Identification Signal (receiver capabilities)
//   DCS (0x40, 0x41) - Digital Command Signal (sender command)
//   CFR (0x80, 0x21) - Confirmation to Receive
//   MCF (0x80, 0x31) - Message Confirmation
//   EOP (0x40, 0x74) - End of Procedure
//   DCN (0x40, 0x5F) - Disconnect

// IFP message type constants
const (
	ifpIndicator = 0 // T30_INDICATOR
	ifpData      = 1 // T30_DATA
)

// T.38 Indicator types
const (
	indCNG         = 0  // Calling tone (1100 Hz)
	indCED         = 1  // Called station ID (2100 Hz)
	indV21Preamble = 2  // V.21 preamble (HDLC flags)
	indV27Train    = 3  // V.27 training
	indV29Train    = 4  // V.29 training
	indV17Train    = 5  // V.17 training
	indV27Short    = 6  // V.27 short training
	indV29Short    = 7  // V.29 7200 training
	indV17Short    = 8  // V.17 short training
)

// T.38 Data types
const (
	dataV21        = 0 // V.21 HDLC (300 bps control channel)
	dataV27_2400   = 1
	dataV27_4800   = 2
	dataV29_7200   = 3
	dataV29_9600   = 4
	dataV17_7200   = 5
	dataV17_9600   = 6
	dataV17_12000  = 7
	dataV17_14400  = 8
)

// T.30 FCF (Facsimile Control Field) values
const (
	fcfDIS  = 0x01 // Digital Identification Signal
	fcfCSI  = 0x02 // Called Subscriber ID
	fcfDCS  = 0x41 // Digital Command Signal
	fcfTSI  = 0x42 // Transmitting Subscriber ID
	fcfCFR  = 0x21 // Confirmation to Receive
	fcfFTT  = 0x22 // Failure to Train
	fcfEOP  = 0x74 // End of Procedure
	fcfMPS  = 0x72 // Multi-page Signal
	fcfMCF  = 0x31 // Message Confirmation
	fcfDCN  = 0x5F // Disconnect
)

// FaxSettings controls the T.30 session parameters.
type FaxSettings struct {
	BaudRate   uint32 // 2400, 4800, 7200, 9600, 14400
	ECM        bool
	Resolution string // "standard" or "fine"
	HeaderLine string // text at top of page
	StationID  string
}

func (s *FaxSettings) normalize() {
	switch s.BaudRate {
	case 2400, 4800, 7200, 9600, 14400:
		// valid
	default:
		s.BaudRate = 9600
	}
	if s.Resolution != "fine" {
		s.Resolution = "standard"
	}
}

// dataTypeForBaud returns the T.38 IFP data type and training indicator for the given baud rate.
func (s *FaxSettings) dataTypeForBaud() (dataType int, trainInd int, trainShort int) {
	switch s.BaudRate {
	case 2400:
		return dataV27_2400, indV27Train, indV27Short
	case 4800:
		return dataV27_4800, indV27Train, indV27Short
	case 7200:
		return dataV29_7200, indV29Train, indV29Short
	case 9600:
		return dataV29_9600, indV29Train, indV29Short
	case 14400:
		return dataV17_14400, indV17Train, indV17Short
	default:
		return dataV29_9600, indV29Train, indV29Short
	}
}

// baudLabel returns a human-readable label for the configured speed.
func (s *FaxSettings) baudLabel() string {
	switch s.BaudRate {
	case 2400:
		return "V.27ter 2400"
	case 4800:
		return "V.27ter 4800"
	case 7200:
		return "V.29 7200"
	case 9600:
		return "V.29 9600"
	case 14400:
		return "V.17 14400"
	default:
		return fmt.Sprintf("%d bps", s.BaudRate)
	}
}

// dcsFIF builds the DCS FIF bytes for the configured settings.
func (s *FaxSettings) dcsFIF() []byte {
	// Byte 1 (FIF[0]): bit3=V.27, bit2=V.29
	// Byte 2 (FIF[1]): bits6-2 = speed + resolution
	// Byte 3 (FIF[2]): bit5=ECM
	var b0, b1, b2 byte

	// Speed bits in DCS byte 2 (bits 4-2)
	switch s.BaudRate {
	case 2400:
		b1 |= 0x00 // V.27ter 2400
	case 4800:
		b1 |= 0x04 // V.27ter 4800
	case 7200:
		b1 |= 0x0C // V.29 7200
	case 9600:
		b1 |= 0x04 // V.29 9600
		b1 |= 0x02 // signalling rate
	case 14400:
		b1 |= 0x02 // V.17 14400
		b1 |= 0x04
	default:
		b1 |= 0x04 | 0x02 // default 9600
	}

	// Resolution: fine = bit 6 set
	if s.Resolution == "fine" {
		b1 |= 0x40
	}

	// ECM: bit 5 of byte 3
	if s.ECM {
		b2 |= 0x20
	}

	return []byte{b0, b1, b2}
}

// tcfBytes returns the number of zero bytes for TCF at this baud rate (1.5 seconds).
func (s *FaxSettings) tcfBytes() int {
	return int(s.BaudRate) * 15 / 80 // (baud * 1.5) / 8
}

// T30Session manages a T.30 fax transmission over T.38.
type T30Session struct {
	udptl    *UDPTLConn
	settings FaxSettings
	events   []FaxEvent
	pagesSent int
}

type FaxEvent struct {
	Time    string `json:"time"`
	Event   string `json:"event"`
	Detail  string `json:"detail,omitempty"`
}

// NewT30Session creates a new T.30 session with the given settings.
func NewT30Session(udptl *UDPTLConn, settings FaxSettings) *T30Session {
	settings.normalize()
	return &T30Session{
		udptl:    udptl,
		settings: settings,
	}
}

func (s *T30Session) addEvent(event, detail string) {
	s.events = append(s.events, FaxEvent{
		Time:   time.Now().Format("15:04:05.000"),
		Event:  event,
		Detail: detail,
	})
}

// SendTestFax performs a minimal T.30 fax send of a test page.
// Returns structured result with events and statistics.
func (s *T30Session) SendTestFax() map[string]interface{} {
	result := map[string]interface{}{
		"station_id":  s.settings.StationID,
		"baud_rate":   s.settings.BaudRate,
		"ecm":         s.settings.ECM,
		"resolution":  s.settings.Resolution,
	}
	start := time.Now()

	resLabel := "standard"
	if s.settings.Resolution == "fine" {
		resLabel = "fine"
	}

	// Phase A: Call establishment (CNG)
	s.addEvent("SEND", "CNG (Calling Tone)")
	if err := s.sendIndicator(indCNG); err != nil {
		s.addEvent("ERROR", "Failed to send CNG: "+err.Error())
		result["success"] = false
		result["error"] = "Failed to send CNG: " + err.Error()
		result["events"] = s.events
		return result
	}

	// Wait for CED from remote
	s.addEvent("WAIT", "Waiting for CED...")
	if err := s.waitForIndicator(indCED, 35*time.Second); err != nil {
		// Try to continue - some gateways skip CED
		s.addEvent("WARN", "No CED received: "+err.Error())
	} else {
		s.addEvent("RECV", "CED (Called Station)")
	}

	// Wait for DIS (Digital Identification Signal)
	s.addEvent("WAIT", "Waiting for DIS...")
	disFrame, err := s.waitForHDLC(fcfDIS, 10*time.Second)
	if err != nil {
		s.addEvent("ERROR", "No DIS received: "+err.Error())
		result["success"] = false
		result["error"] = "No DIS received: " + err.Error()
		result["phase"] = "B"
		result["events"] = s.events
		return result
	}
	s.addEvent("RECV", fmt.Sprintf("DIS (capabilities: %d bytes)", len(disFrame)))

	// Parse remote capabilities from DIS
	remoteCapabilities := parseDISCapabilities(disFrame)
	result["remote_capabilities"] = remoteCapabilities

	// Phase B: Pre-message procedure
	// Send TSI (Transmitting Subscriber ID) if we have one
	if s.settings.StationID != "" {
		s.addEvent("SEND", "TSI: "+s.settings.StationID)
		if err := s.sendTSI(s.settings.StationID); err != nil {
			s.addEvent("WARN", "TSI send failed: "+err.Error())
		}
	}

	// Send DCS (Digital Command Signal) - our transmission parameters
	s.addEvent("SEND", fmt.Sprintf("DCS (%s, %s res, ECM=%v)", s.settings.baudLabel(), resLabel, s.settings.ECM))
	if err := s.sendDCS(); err != nil {
		s.addEvent("ERROR", "Failed to send DCS: "+err.Error())
		result["success"] = false
		result["error"] = "Failed to send DCS"
		result["events"] = s.events
		return result
	}

	// Send training
	_, trainInd, _ := s.settings.dataTypeForBaud()
	s.addEvent("SEND", fmt.Sprintf("%s Training", s.settings.baudLabel()))
	if err := s.sendIndicator(trainInd); err != nil {
		s.addEvent("WARN", "Training indicator failed")
	}

	// Send TCF (Training Check Frame) - 1.5 seconds of zeros
	s.addEvent("SEND", fmt.Sprintf("TCF (%d bytes @ %d bps)", s.settings.tcfBytes(), s.settings.BaudRate))
	if err := s.sendTCF(); err != nil {
		s.addEvent("WARN", "TCF send failed")
	}

	// Wait for CFR (Confirmation to Receive) or FTT (Failure to Train)
	s.addEvent("WAIT", "Waiting for CFR...")
	cfrFrame, err := s.waitForHDLC(fcfCFR, 10*time.Second)
	if err != nil {
		s.addEvent("ERROR", "No CFR received: "+err.Error())
		result["success"] = false
		result["error"] = "Training failed - no CFR received"
		result["phase"] = "B"
		result["events"] = s.events
		s.sendDisconnect()
		return result
	}
	_ = cfrFrame
	s.addEvent("RECV", "CFR (Ready to Receive)")

	// Phase C: Message transmission
	s.addEvent("SEND", "Page data (test pattern)")
	pageData := generateT4TestPageWithSettings(s.settings)
	if err := s.sendPageData(pageData); err != nil {
		s.addEvent("ERROR", "Page send failed: "+err.Error())
		result["success"] = false
		result["error"] = "Page transmission failed"
		result["events"] = s.events
		s.sendDisconnect()
		return result
	}
	s.pagesSent++
	s.addEvent("SEND", fmt.Sprintf("Page complete (%d bytes encoded)", len(pageData)))

	// Phase D: Post-message procedure
	// Send EOP (End of Procedure)
	s.addEvent("SEND", "EOP (End of Procedure)")
	if err := s.sendEOP(); err != nil {
		s.addEvent("WARN", "EOP send failed")
	}

	// Wait for MCF (Message Confirmation)
	s.addEvent("WAIT", "Waiting for MCF...")
	_, err = s.waitForHDLC(fcfMCF, 10*time.Second)
	if err != nil {
		s.addEvent("WARN", "No MCF received: "+err.Error())
	} else {
		s.addEvent("RECV", "MCF (Page Confirmed)")
	}

	// Phase E: Disconnect
	s.addEvent("SEND", "DCN (Disconnect)")
	s.sendDisconnect()

	elapsed := time.Since(start)
	result["success"] = true
	result["pages_sent"] = s.pagesSent
	result["elapsed_secs"] = elapsed.Seconds()
	result["events"] = s.events
	return result
}

// ─── IFP Encoding ───────────────────────────────────────────────────────────

// buildIFP builds a T.38 IFP packet.
// Type 0 = indicator, Type 1 = data
func buildIFP(msgType int, subType int, payload []byte) []byte {
	// Simple IFP encoding:
	// Byte 0: message type (high nibble) | data type (low nibble)
	// Byte 1+: payload (for data messages)
	if msgType == ifpIndicator {
		return []byte{byte(subType)}
	}
	// Data message
	result := []byte{byte(0x10 | (subType & 0x0F))}
	if payload != nil {
		result = append(result, payload...)
	}
	return result
}

// ─── T.30 Message Sending ───────────────────────────────────────────────────

func (s *T30Session) sendIndicator(indType int) error {
	ifp := buildIFP(ifpIndicator, indType, nil)
	// Send indicator multiple times for reliability
	for i := 0; i < 3; i++ {
		if err := s.udptl.SendIFP(ifp); err != nil {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
	return nil
}

func (s *T30Session) sendHDLCFrame(fcf byte, fif []byte, finalFrame bool) error {
	// V.21 preamble first
	if err := s.sendIndicator(indV21Preamble); err != nil {
		return err
	}
	time.Sleep(100 * time.Millisecond)

	// Build HDLC frame: address + control + FCF + FIF
	frame := []byte{0xFF, 0x03} // Address=0xFF, Control=0x03 (UI frame)
	if finalFrame {
		frame[1] = 0x13 // Final frame indicator
	}
	frame = append(frame, fcf)
	if fif != nil {
		frame = append(frame, fif...)
	}

	// Send as V.21 HDLC data
	ifp := buildIFP(ifpData, dataV21, frame)
	for i := 0; i < 2; i++ { // Send twice for reliability
		if err := s.udptl.SendIFP(ifp); err != nil {
			return err
		}
		time.Sleep(30 * time.Millisecond)
	}
	return nil
}

func (s *T30Session) sendTSI(stationID string) error {
	// TSI is sent as ASCII, reversed, padded to 20 chars with spaces
	tsi := make([]byte, 20)
	for i := range tsi {
		tsi[i] = 0x20 // space
	}
	id := []byte(stationID)
	if len(id) > 20 {
		id = id[:20]
	}
	// Reverse into buffer
	for i, b := range id {
		tsi[19-i] = b
	}
	return s.sendHDLCFrame(fcfTSI, tsi, false)
}

func (s *T30Session) sendDCS() error {
	fif := s.settings.dcsFIF()
	return s.sendHDLCFrame(fcfDCS, fif, true)
}

func (s *T30Session) sendTCF() error {
	// TCF = 1.5 seconds of zeros at the negotiated speed
	dataType, _, _ := s.settings.dataTypeForBaud()
	tcfData := make([]byte, s.settings.tcfBytes())
	ifp := buildIFP(ifpData, dataType, tcfData)
	return s.udptl.SendIFP(ifp)
}

func (s *T30Session) sendPageData(t4Data []byte) error {
	dataType, trainInd, _ := s.settings.dataTypeForBaud()
	baud := int(s.settings.BaudRate)
	if baud == 0 {
		baud = 9600
	}

	// Send training indicator first
	if err := s.sendIndicator(trainInd); err != nil {
		return err
	}
	time.Sleep(100 * time.Millisecond)

	// Send page data in chunks (T.4 encoded)
	chunkSize := 400
	for offset := 0; offset < len(t4Data); offset += chunkSize {
		end := offset + chunkSize
		if end > len(t4Data) {
			end = len(t4Data)
		}
		chunk := t4Data[offset:end]
		ifp := buildIFP(ifpData, dataType, chunk)
		if err := s.udptl.SendIFP(ifp); err != nil {
			return err
		}
		// Pace data transmission (simulate real-time at configured baud rate)
		time.Sleep(time.Duration(len(chunk)*8*1000/baud) * time.Millisecond)
	}

	// Send RTC (Return to Control) - 6 consecutive EOLs
	rtc := []byte{0x00, 0x08, 0x80, 0x00, 0x08, 0x80, 0x00, 0x08, 0x80}
	ifp := buildIFP(ifpData, dataType, rtc)
	return s.udptl.SendIFP(ifp)
}

func (s *T30Session) sendEOP() error {
	return s.sendHDLCFrame(fcfEOP, nil, true)
}

func (s *T30Session) sendDisconnect() {
	s.sendHDLCFrame(fcfDCN, nil, true)
}

// ─── T.30 Message Receiving ─────────────────────────────────────────────────

func (s *T30Session) waitForIndicator(expected int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ifpData, _, err := s.udptl.RecvIFP(2 * time.Second)
		if err != nil {
			continue
		}
		if len(ifpData) < 1 {
			continue
		}
		// Check if it's an indicator matching what we expect
		if ifpData[0] == byte(expected) {
			return nil
		}
	}
	return fmt.Errorf("timeout waiting for indicator %d", expected)
}

func (s *T30Session) waitForHDLC(expectedFCF byte, timeout time.Duration) ([]byte, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ifpData, _, err := s.udptl.RecvIFP(2 * time.Second)
		if err != nil {
			continue
		}
		if len(ifpData) < 2 {
			continue
		}
		// Check if this is a V.21 data message
		msgType := ifpData[0] >> 4
		if msgType != 1 { // Not a data message
			continue
		}
		// Extract HDLC frame from data
		payload := ifpData[1:]
		if len(payload) < 3 {
			continue
		}
		// HDLC: Address(0xFF) + Control + FCF + optional FIF
		fcf := payload[2]
		if fcf == expectedFCF {
			return payload, nil
		}
		// Also accept the FCF without the FF/C8 high bit variations
		if (fcf & 0x7F) == (expectedFCF & 0x7F) {
			return payload, nil
		}
	}
	return nil, fmt.Errorf("timeout waiting for FCF 0x%02X", expectedFCF)
}

// ─── DIS Parsing ────────────────────────────────────────────────────────────

func parseDISCapabilities(frame []byte) map[string]interface{} {
	caps := map[string]interface{}{
		"received": true,
	}
	if len(frame) < 6 { // address + control + FCF + 3 FIF bytes min
		return caps
	}
	fif := frame[3:]
	if len(fif) >= 1 {
		caps["v27_2400"] = fif[0]&0x08 != 0
		caps["v29_9600"] = fif[0]&0x04 != 0
	}
	if len(fif) >= 2 {
		caps["fine_resolution"] = fif[1]&0x40 != 0
		caps["v17_14400"] = fif[1]&0x20 != 0
	}
	if len(fif) >= 3 {
		caps["ecm"] = fif[2]&0x20 != 0
		caps["t38"] = fif[2]&0x10 != 0
	}
	return caps
}
