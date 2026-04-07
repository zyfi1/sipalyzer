//! Audio processing pipeline: AGC, VAD, PLC, and stubs for AEC and noise suppression.
//!
//! Processing order (send path): mic → AEC → noise suppression → AGC → VAD → encoder
//! Processing order (recv path): decoder → PLC (on missing packet) → speaker

use std::sync::Mutex;

/// Automatic Gain Control: normalizes RMS of PCM frames to a target level.
/// This is a simple RMS-based AGC with attack/release smoothing.
pub struct Agc {
    target_rms: f64,
    gain: f64,
    max_gain: f64,
    min_gain: f64,
    attack: f64,  // fast attack (gain decrease) smoothing factor
    release: f64, // slow release (gain increase) smoothing factor
}

impl Agc {
    pub fn new(target_rms_db: f64) -> Self {
        // Convert dBFS target to linear RMS
        let target_rms = 10.0_f64.powf(target_rms_db / 20.0) * 32768.0;
        Self {
            target_rms,
            gain: 1.0,
            max_gain: 10.0, // +20 dB max boost
            min_gain: 0.1,  // -20 dB max attenuation
            attack: 0.1,    // fast when too loud
            release: 0.01,  // slow when too quiet (avoid pumping)
        }
    }

    /// Process a PCM frame in-place. Returns the adjusted gain value.
    pub fn process(&mut self, pcm: &mut [i16]) -> f64 {
        if pcm.is_empty() {
            return self.gain;
        }

        // Compute RMS of the frame
        let sum_sq: f64 = pcm.iter().map(|&s| (s as f64) * (s as f64)).sum();
        let rms = (sum_sq / pcm.len() as f64).sqrt();

        if rms < 1.0 {
            // Near-silence: don't adjust gain (avoid dividing by ~zero)
            return self.gain;
        }

        // Compute desired gain
        let desired = (self.target_rms / rms).clamp(self.min_gain, self.max_gain);

        // Smooth gain changes: fast attack, slow release
        let alpha = if desired < self.gain {
            self.attack
        } else {
            self.release
        };
        self.gain = self.gain * (1.0 - alpha) + desired * alpha;
        self.gain = self.gain.clamp(self.min_gain, self.max_gain);

        // Apply gain
        for s in pcm.iter_mut() {
            let v = (*s as f64 * self.gain).clamp(-32768.0, 32767.0);
            *s = v as i16;
        }

        self.gain
    }
}

/// Voice Activity Detection: simple energy-based VAD.
/// Returns true if the frame contains voice, false if silence.
pub struct Vad {
    /// Energy threshold (RMS below this = silence). In linear PCM units.
    threshold: f64,
    /// Hangover frames: continue reporting "voice" for N frames after energy drops.
    hangover_max: u32,
    hangover_count: u32,
}

impl Vad {
    pub fn new(threshold_dbfs: f64) -> Self {
        let threshold = 10.0_f64.powf(threshold_dbfs / 20.0) * 32768.0;
        Self {
            threshold,
            hangover_max: 10, // 10 frames × 20ms = 200ms hangover
            hangover_count: 0,
        }
    }

    /// Returns true if voice is detected in the frame.
    pub fn is_voice(&mut self, pcm: &[i16]) -> bool {
        if pcm.is_empty() {
            return false;
        }
        let sum_sq: f64 = pcm.iter().map(|&s| (s as f64) * (s as f64)).sum();
        let rms = (sum_sq / pcm.len() as f64).sqrt();

        if rms >= self.threshold {
            self.hangover_count = self.hangover_max;
            true
        } else if self.hangover_count > 0 {
            self.hangover_count -= 1;
            true
        } else {
            false
        }
    }
}

/// Packet Loss Concealment: repeats the last decoded frame (with decay) when a packet is missing.
pub struct Plc {
    last_frame: Vec<i16>,
    consecutive_losses: u32,
    decay_factor: f64,
}

impl Plc {
    pub fn new() -> Self {
        Self {
            last_frame: Vec::new(),
            consecutive_losses: 0,
            decay_factor: 0.9, // 10% volume reduction per consecutive loss
        }
    }

    /// Call when a good frame is decoded: stores it for potential concealment.
    pub fn good_frame(&mut self, pcm: &[i16]) {
        self.last_frame.clear();
        self.last_frame.extend_from_slice(pcm);
        self.consecutive_losses = 0;
    }

    /// Call when a frame is missing: returns a concealed frame.
    /// Returns None if no previous frame is available (e.g., very first frame lost).
    pub fn conceal(&mut self) -> Option<Vec<i16>> {
        if self.last_frame.is_empty() {
            return None;
        }
        self.consecutive_losses += 1;
        // Apply decay: each consecutive loss reduces volume
        let decay = self.decay_factor.powi(self.consecutive_losses as i32);
        let concealed: Vec<i16> = self
            .last_frame
            .iter()
            .map(|&s| (s as f64 * decay).clamp(-32768.0, 32767.0) as i16)
            .collect();
        // After 5 consecutive losses, fade to silence (50ms)
        if self.consecutive_losses > 5 {
            return Some(vec![0i16; self.last_frame.len()]);
        }
        Some(concealed)
    }
}

/// Acoustic Echo Cancellation using NLMS adaptive filter.
///
/// The AEC removes echo from the microphone signal by subtracting an estimate
/// of the acoustic echo (speaker → mic coupling). It uses the far-end (speaker)
/// signal as a reference and adapts a filter to model the echo path.
pub struct Aec {
    /// Adaptive filter coefficients.
    filter: Vec<f64>,
    /// Circular buffer of far-end reference samples.
    far_buf: Vec<f64>,
    /// Write position in far_buf.
    pos: usize,
    /// NLMS step size (0 < mu < 2, typically 0.5–1.0).
    mu: f64,
    /// Regularization term to avoid division by zero.
    delta: f64,
}

impl Aec {
    /// Create a new AEC with the given filter length (in samples).
    /// For 8 kHz audio, 128 taps ≈ 16 ms tail, 1024 taps ≈ 128 ms tail.
    pub fn new(filter_len: usize) -> Self {
        Self {
            filter: vec![0.0; filter_len],
            far_buf: vec![0.0; filter_len],
            pos: 0,
            mu: 0.5,
            delta: 1.0,
        }
    }

    /// Feed a block of far-end (speaker playback) samples as the reference.
    /// Must be called with each playout frame BEFORE processing the corresponding mic frame.
    pub fn feed_far_end(&mut self, far: &[i16]) {
        for &s in far {
            self.far_buf[self.pos] = s as f64;
            self.pos = (self.pos + 1) % self.far_buf.len();
        }
    }

    /// Process a mic (near-end) frame in-place: subtract the estimated echo.
    pub fn cancel(&mut self, mic: &mut [i16]) {
        let n = self.filter.len();
        for sample in mic.iter_mut() {
            // Build reference vector (most recent n far-end samples in reverse order)
            let mut echo_est = 0.0;
            let mut power = self.delta;
            for k in 0..n {
                let idx = (self.pos + self.far_buf.len() - 1 - k) % self.far_buf.len();
                let x = self.far_buf[idx];
                echo_est += self.filter[k] * x;
                power += x * x;
            }

            let near = *sample as f64;
            let error = near - echo_est;

            // NLMS coefficient update
            let step = self.mu / power;
            for k in 0..n {
                let idx = (self.pos + self.far_buf.len() - 1 - k) % self.far_buf.len();
                self.filter[k] += step * error * self.far_buf[idx];
            }

            *sample = error.clamp(-32768.0, 32767.0) as i16;
        }
    }
}

/// Spectral-subtraction noise suppressor.
///
/// Estimates the noise floor from recent quiet frames and subtracts it
/// from the signal magnitude spectrum, preserving phase. Uses
/// over-subtraction factor and spectral floor to avoid musical noise.
pub struct NoiseSuppressor {
    /// FFT size (must be power of 2, matches frame size).
    fft_size: usize,
    /// Running estimate of the noise magnitude spectrum.
    noise_est: Vec<f64>,
    /// Smoothing factor for noise estimate update (0 < α < 1).
    alpha: f64,
    /// Over-subtraction factor (>1 = more aggressive removal).
    over_sub: f64,
    /// Spectral floor to prevent complete zeroing (musical noise prevention).
    spectral_floor: f64,
    /// Number of initial frames used to initialize noise estimate.
    init_frames: u32,
    frame_count: u32,
}

impl NoiseSuppressor {
    pub fn new(fft_size: usize) -> Self {
        Self {
            fft_size,
            noise_est: vec![0.0; fft_size / 2 + 1],
            alpha: 0.98,
            over_sub: 2.0,
            spectral_floor: 0.01,
            init_frames: 15,
            frame_count: 0,
        }
    }

    /// Process a PCM frame in-place. Subtracts estimated noise from the spectrum.
    pub fn process(&mut self, pcm: &mut [i16]) {
        let n = pcm.len().min(self.fft_size);
        if n < 4 {
            return;
        }

        // Convert to f64
        let mut buf: Vec<f64> = pcm[..n].iter().map(|&s| s as f64).collect();
        buf.resize(self.fft_size, 0.0);

        // Simple DFT of real signal (we only need magnitude/phase of first half+1 bins)
        let half = self.fft_size / 2 + 1;
        let mut mag = vec![0.0f64; half];
        let mut phase = vec![0.0f64; half];

        for k in 0..half {
            let mut re = 0.0;
            let mut im = 0.0;
            for (t, sample) in buf.iter().enumerate() {
                let angle =
                    -2.0 * std::f64::consts::PI * (k as f64) * (t as f64) / (self.fft_size as f64);
                re += sample * angle.cos();
                im += sample * angle.sin();
            }
            mag[k] = (re * re + im * im).sqrt();
            phase[k] = im.atan2(re);
        }

        // Update noise estimate
        self.frame_count += 1;
        if self.frame_count <= self.init_frames {
            // During init, accumulate average noise
            for k in 0..half {
                self.noise_est[k] =
                    self.noise_est[k] + (mag[k] - self.noise_est[k]) / self.frame_count as f64;
            }
        } else {
            // Slow upward tracking of noise floor (only when signal is close to current estimate)
            for k in 0..half {
                if mag[k] < self.noise_est[k] * 3.0 {
                    self.noise_est[k] =
                        self.alpha * self.noise_est[k] + (1.0 - self.alpha) * mag[k];
                }
            }
        }

        // Spectral subtraction
        for k in 0..half {
            let clean = mag[k] - self.over_sub * self.noise_est[k];
            mag[k] = clean.max(self.spectral_floor * mag[k]);
        }

        // Inverse DFT back to time domain
        for t in 0..n {
            let mut sum = 0.0;
            for k in 0..half {
                let angle =
                    2.0 * std::f64::consts::PI * (k as f64) * (t as f64) / (self.fft_size as f64);
                let re = mag[k] * phase[k].cos();
                let im = mag[k] * phase[k].sin();
                sum += re * angle.cos() - im * angle.sin();
                // Mirror bins (except DC and Nyquist)
                if k > 0 && k < self.fft_size / 2 {
                    sum += re * angle.cos() + im * angle.sin();
                }
            }
            sum /= self.fft_size as f64;
            pcm[t] = sum.clamp(-32768.0, 32767.0) as i16;
        }
    }
}

/// Combined audio processor for the send path (mic → network).
pub struct SendProcessor {
    pub agc: Mutex<Agc>,
    pub vad: Mutex<Vad>,
    pub aec: Mutex<Aec>,
    pub ns: Mutex<NoiseSuppressor>,
    pub agc_enabled: bool,
    pub vad_enabled: bool,
    pub aec_enabled: bool,
    pub ns_enabled: bool,
}

impl SendProcessor {
    pub fn new(agc_enabled: bool, vad_enabled: bool) -> Self {
        Self {
            agc: Mutex::new(Agc::new(-20.0)),
            vad: Mutex::new(Vad::new(-45.0)),
            aec: Mutex::new(Aec::new(512)),
            ns: Mutex::new(NoiseSuppressor::new(160)), // 160 samples = 20 ms at 8 kHz
            agc_enabled,
            vad_enabled,
            aec_enabled: true,
            ns_enabled: true,
        }
    }

    /// Feed far-end audio to the AEC reference. Call with every playout frame.
    pub fn feed_far_end(&self, pcm: &[i16]) {
        if self.aec_enabled {
            if let Ok(mut aec) = self.aec.lock() {
                aec.feed_far_end(pcm);
            }
        }
    }

    /// Process a PCM frame before encoding. Returns is_voice.
    pub fn process(&self, pcm: &mut [i16]) -> bool {
        // AEC first (remove echo before noise/AGC/VAD)
        if self.aec_enabled {
            if let Ok(mut aec) = self.aec.lock() {
                aec.cancel(pcm);
            }
        }
        // Noise suppression
        if self.ns_enabled {
            if let Ok(mut ns) = self.ns.lock() {
                ns.process(pcm);
            }
        }
        // AGC
        if self.agc_enabled {
            if let Ok(mut agc) = self.agc.lock() {
                agc.process(pcm);
            }
        }
        // VAD
        if self.vad_enabled {
            if let Ok(mut vad) = self.vad.lock() {
                return vad.is_voice(pcm);
            }
        }
        true
    }
}

/// Combined audio processor for the receive path (network → speaker).
pub struct RecvProcessor {
    pub plc: Mutex<Plc>,
    pub plc_enabled: bool,
}

impl RecvProcessor {
    pub fn new(plc_enabled: bool) -> Self {
        Self {
            plc: Mutex::new(Plc::new()),
            plc_enabled,
        }
    }

    /// Record a successfully decoded frame for PLC.
    pub fn good_frame(&self, pcm: &[i16]) {
        if self.plc_enabled {
            if let Ok(mut plc) = self.plc.lock() {
                plc.good_frame(pcm);
            }
        }
    }

    /// Get a concealed frame when a packet is lost.
    pub fn conceal(&self) -> Option<Vec<i16>> {
        if self.plc_enabled {
            if let Ok(mut plc) = self.plc.lock() {
                return plc.conceal();
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agc_boosts_quiet_signal() {
        let mut agc = Agc::new(-20.0);
        // Very quiet signal
        let mut frame: Vec<i16> = (0..160)
            .map(|i| ((i as f64 * 0.1).sin() * 100.0) as i16)
            .collect();
        let rms_before: f64 =
            (frame.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / frame.len() as f64).sqrt();
        for _ in 0..50 {
            agc.process(&mut frame);
        }
        let rms_after: f64 =
            (frame.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / frame.len() as f64).sqrt();
        assert!(rms_after > rms_before, "AGC should boost quiet signal");
    }

    #[test]
    fn vad_detects_silence() {
        let mut vad = Vad::new(-45.0);
        let silence = vec![0i16; 160];
        // After hangover expires
        for _ in 0..20 {
            vad.is_voice(&silence);
        }
        assert!(!vad.is_voice(&silence));
    }

    #[test]
    fn plc_conceals_missing_frame() {
        let mut plc = Plc::new();
        let frame: Vec<i16> = (0..160).map(|i| (i * 100) as i16).collect();
        plc.good_frame(&frame);
        let concealed = plc.conceal();
        assert!(concealed.is_some());
        assert_eq!(concealed.unwrap().len(), 160);
    }

    #[test]
    fn ns_reduces_noise() {
        let mut ns = NoiseSuppressor::new(160);
        // Feed white noise frames to let it learn the noise floor
        let noise: Vec<i16> = (0..160).map(|i| ((i * 7 + 13) % 100 - 50) as i16).collect();
        for _ in 0..20 {
            let mut frame = noise.clone();
            ns.process(&mut frame);
        }
        // After adaptation, noise should be reduced
        let mut frame = noise.clone();
        ns.process(&mut frame);
        let noise_power: f64 =
            frame.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / frame.len() as f64;
        let orig_power: f64 =
            noise.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / noise.len() as f64;
        assert!(
            noise_power < orig_power,
            "Noise suppressor should reduce noise power"
        );
    }

    #[test]
    fn aec_reduces_echo() {
        let mut aec = Aec::new(64);
        // Simulate a far-end tone and the same tone picked up by the mic (echo)
        let far: Vec<i16> = (0..160)
            .map(|i| ((i as f64 * 0.05).sin() * 10000.0) as i16)
            .collect();
        // Feed far-end multiple times to let the filter adapt
        for _ in 0..50 {
            aec.feed_far_end(&far);
            let mut mic = far.clone(); // mic picks up pure echo
            aec.cancel(&mut mic);
        }
        // After adaptation, echo should be reduced
        aec.feed_far_end(&far);
        let mut mic = far.clone();
        aec.cancel(&mut mic);
        let echo_power: f64 =
            mic.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / mic.len() as f64;
        let orig_power: f64 =
            far.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / far.len() as f64;
        assert!(
            echo_power < orig_power * 0.5,
            "AEC should reduce echo by at least 3 dB"
        );
    }
}
