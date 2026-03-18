/**
 * DTMF local tone playback using Web Audio API.
 *
 * Each DTMF digit is a dual-tone multi-frequency signal — two sine waves played together.
 * This plays a short local feedback tone (80ms) so the user hears confirmation
 * when pressing keypad buttons during a call.
 *
 * Frequencies per ITU-T Q.23:
 *   Low group:  697, 770, 852, 941 Hz
 *   High group: 1209, 1336, 1477, 1633 Hz
 */

// DTMF frequency pairs: [lowFreq, highFreq]
const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "A": [697, 1633],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "B": [770, 1633],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "C": [852, 1633],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
  "D": [941, 1633],
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Play a local DTMF tone for the given digit.
 * Duration is 80ms with a short ramp-down to avoid clicks.
 * Volume is moderate (-12 dBFS) to not be jarring.
 */
export function playDtmfTone(digit: string): void {
  const freqs = DTMF_FREQUENCIES[digit.toUpperCase()];
  if (!freqs) return;

  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;
    const duration = 0.08; // 80ms
    const rampDown = 0.015; // 15ms fade-out to avoid click
    const volume = 0.12; // -18 dBFS — audible but not harsh

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.setValueAtTime(volume, now + duration - rampDown);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    gain.connect(ctx.destination);

    // Low frequency oscillator
    const oscLow = ctx.createOscillator();
    oscLow.type = "sine";
    oscLow.frequency.setValueAtTime(freqs[0], now);
    oscLow.connect(gain);
    oscLow.start(now);
    oscLow.stop(now + duration);

    // High frequency oscillator
    const oscHigh = ctx.createOscillator();
    oscHigh.type = "sine";
    oscHigh.frequency.setValueAtTime(freqs[1], now);
    oscHigh.connect(gain);
    oscHigh.start(now);
    oscHigh.stop(now + duration);
  } catch {
    // Silently ignore — audio playback is best-effort feedback
  }
}
