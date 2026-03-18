package main

import (
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// ─── OS-level Text-to-Speech for RTP audio ──────────────────────────────────
//
// Uses the operating system's built-in TTS engine to generate speech audio,
// then converts to G.711 µ-law at 8 kHz for use in RTP streams.
//
//   macOS:   `say` command → AIFF → `afconvert` → 8 kHz PCM WAV → µ-law
//   Linux:   `espeak` command → WAV stdout → µ-law
//   Windows: PowerShell SAPI → WAV → µ-law
//
// Falls back to the embedded static TTS recording if the OS TTS is unavailable.

// TTSInfo holds metadata about the generated TTS audio for UI display.
type TTSInfo struct {
	Source     string  // "os_tts" or "embedded"
	Engine     string  // e.g. "macOS say", "espeak-ng", "SAPI", "pre-recorded"
	Text       string  // the spoken phrase
	Samples    int     // total µ-law samples
	DurationMs int64   // generation wall-clock time in ms
	AudioSecs  float64 // audio duration in seconds
}

var (
	cachedTTSAudio []byte
	cachedTTSInfo  TTSInfo
	ttsOnce        sync.Once
)

// GenerateTestCallAudio returns µ-law audio of "this is a test call".
// It tries OS TTS first, then falls back to the embedded recording.
func GenerateTestCallAudio() []byte {
	ttsOnce.Do(func() {
		genStart := time.Now()
		audio, engine, err := generateWithOSTTS("this is a test call")
		genDur := time.Since(genStart)

		if err != nil {
			log.Printf("[TTS] OS TTS unavailable (%v), using embedded audio", err)
			cachedTTSAudio = ttsAudioMulaw[:]
			cachedTTSInfo = TTSInfo{
				Source:     "embedded",
				Engine:     "pre-recorded",
				Text:       "this is a test call",
				Samples:    len(ttsAudioMulaw),
				DurationMs: 0,
				AudioSecs:  float64(len(ttsAudioMulaw)) / 8000.0,
			}
			return
		}

		log.Printf("[TTS] Generated %d samples (%.2fs) via %s in %dms",
			len(audio), float64(len(audio))/8000.0, engine, genDur.Milliseconds())

		// Append 0.5s silence for clean loop gap
		silence := make([]byte, 4000)
		for i := range silence {
			silence[i] = 0xFF // µ-law silence
		}
		withSilence := append(audio, silence...)
		cachedTTSAudio = withSilence
		cachedTTSInfo = TTSInfo{
			Source:     "os_tts",
			Engine:     engine,
			Text:       "this is a test call",
			Samples:    len(withSilence),
			DurationMs: genDur.Milliseconds(),
			AudioSecs:  float64(len(withSilence)) / 8000.0,
		}
	})
	return cachedTTSAudio
}

// GetTTSInfo returns metadata about the last TTS generation.
// Call after GenerateTestCallAudio().
func GetTTSInfo() TTSInfo {
	return cachedTTSInfo
}

// generateWithOSTTS uses the OS text-to-speech engine to produce µ-law audio.
// Returns (audio, engine_name, error).
func generateWithOSTTS(text string) ([]byte, string, error) {
	tmpDir, err := os.MkdirTemp("", "sipalyzer-tts-")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(tmpDir)

	switch runtime.GOOS {
	case "darwin":
		audio, err := ttsMacOS(text, tmpDir)
		return audio, "macOS say", err
	case "linux":
		return ttsLinux(text, tmpDir)
	case "windows":
		audio, err := ttsWindows(text, tmpDir)
		return audio, "Windows SAPI", err
	default:
		return nil, "", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// ttsMacOS uses `say` + `afconvert` to produce 8 kHz PCM.
func ttsMacOS(text, tmpDir string) ([]byte, error) {
	aiffPath := filepath.Join(tmpDir, "tts.aiff")
	wavPath := filepath.Join(tmpDir, "tts.wav")

	// Generate speech AIFF
	if err := exec.Command("say", "-o", aiffPath, text).Run(); err != nil {
		return nil, fmt.Errorf("say: %w", err)
	}

	// Convert to 8 kHz 16-bit mono PCM WAV
	if err := exec.Command("afconvert", "-f", "WAVE", "-d", "LEI16@8000", "-c", "1", aiffPath, wavPath).Run(); err != nil {
		return nil, fmt.Errorf("afconvert: %w", err)
	}

	return wavToMulaw(wavPath)
}

// ttsLinux uses `espeak` to generate speech directly to WAV.
// Returns (audio, engine_name, error).
func ttsLinux(text, tmpDir string) ([]byte, string, error) {
	wavPath := filepath.Join(tmpDir, "tts.wav")

	// espeak can output WAV. Try espeak-ng first (modern), then espeak.
	usedCmd := ""
	for _, cmd := range []string{"espeak-ng", "espeak"} {
		if _, lookErr := exec.LookPath(cmd); lookErr == nil {
			if err := exec.Command(cmd, "-w", wavPath, "-s", "150", text).Run(); err == nil {
				usedCmd = cmd
				break
			}
		}
	}
	if usedCmd == "" {
		return nil, "", fmt.Errorf("espeak/espeak-ng not found or failed")
	}

	// espeak outputs at 22050 Hz typically. We need to resample to 8000 Hz.
	// Try sox first, then ffmpeg, then do a crude nearest-neighbor resample.
	resampled := filepath.Join(tmpDir, "tts_8k.wav")
	if soxPath, _ := exec.LookPath("sox"); soxPath != "" {
		if err := exec.Command("sox", wavPath, "-r", "8000", "-c", "1", "-b", "16", resampled).Run(); err == nil {
			audio, err := wavToMulaw(resampled)
			return audio, usedCmd, err
		}
	}
	if ffPath, _ := exec.LookPath("ffmpeg"); ffPath != "" {
		if err := exec.Command("ffmpeg", "-y", "-i", wavPath, "-ar", "8000", "-ac", "1", "-f", "wav", resampled).Run(); err == nil {
			audio, err := wavToMulaw(resampled)
			return audio, usedCmd, err
		}
	}

	// Fallback: read the WAV and do crude resampling in Go
	audio, err := wavToMulawWithResample(wavPath, 8000)
	return audio, usedCmd, err
}

// ttsWindows uses PowerShell SAPI to generate speech.
func ttsWindows(text, tmpDir string) ([]byte, error) {
	wavPath := filepath.Join(tmpDir, "tts.wav")

	psScript := fmt.Sprintf(
		`Add-Type -AssemblyName System.Speech; `+
			`$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; `+
			`$synth.SetOutputToWaveFile('%s'); `+
			`$synth.Speak('%s'); `+
			`$synth.Dispose()`,
		wavPath, text,
	)
	if err := exec.Command("powershell", "-NoProfile", "-Command", psScript).Run(); err != nil {
		return nil, fmt.Errorf("powershell SAPI: %w", err)
	}

	return wavToMulawWithResample(wavPath, 8000)
}

// wavToMulaw reads a 8 kHz 16-bit mono PCM WAV and converts to µ-law.
func wavToMulaw(wavPath string) ([]byte, error) {
	data, err := os.ReadFile(wavPath)
	if err != nil {
		return nil, err
	}
	if len(data) < 44 {
		return nil, fmt.Errorf("WAV file too short")
	}

	// Skip WAV header (44 bytes for standard PCM WAV)
	pcm := data[44:]
	n := len(pcm) / 2
	ulaw := make([]byte, n)
	for i := 0; i < n; i++ {
		sample := int16(binary.LittleEndian.Uint16(pcm[i*2 : i*2+2]))
		ulaw[i] = linearToMulaw(sample)
	}
	return ulaw, nil
}

// wavToMulawWithResample reads a WAV at any sample rate and resamples to targetRate.
func wavToMulawWithResample(wavPath string, targetRate int) ([]byte, error) {
	data, err := os.ReadFile(wavPath)
	if err != nil {
		return nil, err
	}
	if len(data) < 44 {
		return nil, fmt.Errorf("WAV file too short")
	}

	// Parse WAV header for sample rate and bits per sample
	srcRate := int(binary.LittleEndian.Uint32(data[24:28]))
	bitsPerSample := int(binary.LittleEndian.Uint16(data[34:36]))
	channels := int(binary.LittleEndian.Uint16(data[22:24]))

	pcmStart := 44
	pcmData := data[pcmStart:]
	bytesPerSample := bitsPerSample / 8
	frameSize := bytesPerSample * channels
	numFrames := len(pcmData) / frameSize

	// Calculate output length
	outLen := numFrames * targetRate / srcRate
	ulaw := make([]byte, outLen)

	for i := 0; i < outLen; i++ {
		// Nearest-neighbor resampling
		srcIdx := i * srcRate / targetRate
		if srcIdx >= numFrames {
			srcIdx = numFrames - 1
		}
		offset := srcIdx * frameSize

		var sample int16
		if bitsPerSample == 16 && offset+1 < len(pcmData) {
			sample = int16(binary.LittleEndian.Uint16(pcmData[offset : offset+2]))
		} else if bitsPerSample == 8 && offset < len(pcmData) {
			sample = (int16(pcmData[offset]) - 128) * 256
		}
		ulaw[i] = linearToMulaw(sample)
	}

	return ulaw, nil
}

// linearToMulaw converts a 16-bit linear PCM sample to ITU-T G.711 µ-law.
func linearToMulaw(sample int16) byte {
	const bias = 0x84
	const clip = 32635

	sign := byte(0)
	if sample < 0 {
		sign = 0x80
		sample = -sample
	}
	if sample > clip {
		sample = clip
	}
	sample += bias

	exponent := byte(7)
	mask := int16(0x4000)
	for exponent > 0 {
		if sample&mask != 0 {
			break
		}
		exponent--
		mask >>= 1
	}

	mantissa := byte((sample >> (exponent + 3)) & 0x0F)
	return ^(sign | (exponent << 4) | mantissa)
}
