/**
 * Text-to-Speech engine wrapping the Web Speech API (SpeechSynthesis).
 *
 * Singleton — import `ttsEngine` and call methods directly. The engine
 * gracefully degrades to no-ops if speechSynthesis is unavailable.
 *
 * Voice loading handles the well-known browser quirk where getVoices()
 * returns an empty array on the first call (resolved via the
 * `voiceschanged` event).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serializable subset of SpeechSynthesisVoice (the native object can't be stored). */
export interface TtsVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  isDefault: boolean;
}

export interface TtsSpeakOptions {
  /** Voice URI to use. Falls back to current default if not found. */
  voiceURI?: string | null;
  /** Speech rate (0.1–10, default 1). */
  rate?: number;
  /** Voice pitch (0–2, default 1). */
  pitch?: number;
  /** Volume (0–1, default 0.8). */
  volume?: number;
}

export type TtsEventCallback = () => void;
export type TtsErrorCallback = (error: string) => void;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

class TtsEngine {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private voiceLoadPromise: Promise<SpeechSynthesisVoice[]> | null = null;

  // Callbacks wired by the store
  onStart: TtsEventCallback = () => {};
  onEnd: TtsEventCallback = () => {};
  onPause: TtsEventCallback = () => {};
  onResume: TtsEventCallback = () => {};
  onError: TtsErrorCallback = () => {};

  constructor() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      this.synth = window.speechSynthesis;
    } else {
      console.warn("[TTS] SpeechSynthesis API not available in this environment.");
    }
  }

  /** Whether the underlying API is available. */
  get available(): boolean {
    return this.synth != null;
  }

  // -----------------------------------------------------------------------
  // Voice loading
  // -----------------------------------------------------------------------

  /**
   * Load available voices. Returns a promise that resolves once the voice
   * list is populated (handles the async `voiceschanged` quirk).
   */
  loadVoices(): Promise<TtsVoiceInfo[]> {
    if (!this.synth) return Promise.resolve([]);

    if (this.voicesLoaded) {
      return Promise.resolve(this.serializeVoices());
    }

    if (this.voiceLoadPromise) {
      return this.voiceLoadPromise.then(() => this.serializeVoices());
    }

    this.voiceLoadPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const tryLoad = () => {
        const v = this.synth!.getVoices();
        if (v.length > 0) {
          this.voices = v;
          this.voicesLoaded = true;
          resolve(v);
          return true;
        }
        return false;
      };

      // Some browsers return voices synchronously
      if (tryLoad()) return;

      // Otherwise wait for the voiceschanged event
      const handler = () => {
        tryLoad();
        this.synth!.removeEventListener("voiceschanged", handler);
      };
      this.synth!.addEventListener("voiceschanged", handler);

      // Safety timeout — if voiceschanged never fires, resolve with whatever we have
      setTimeout(() => {
        if (!this.voicesLoaded) {
          this.voices = this.synth!.getVoices();
          this.voicesLoaded = true;
          this.synth!.removeEventListener("voiceschanged", handler);
          resolve(this.voices);
        }
      }, 2000);
    });

    return this.voiceLoadPromise.then(() => this.serializeVoices());
  }

  /** Get the currently loaded voices as serializable objects. */
  getVoices(): TtsVoiceInfo[] {
    return this.serializeVoices();
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  /** Speak the given text. Cancels any current speech first (interrupt mode). */
  speak(text: string, options: TtsSpeakOptions = {}): void {
    if (!this.synth || !text.trim()) return;

    // Interrupt current speech
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Resolve voice
    const targetURI = options.voiceURI ?? null;
    if (targetURI) {
      const voice = this.voices.find((v) => v.voiceURI === targetURI);
      if (voice) utterance.voice = voice;
    }

    utterance.rate = Math.max(0.1, Math.min(10, options.rate ?? 1));
    utterance.pitch = Math.max(0, Math.min(2, options.pitch ?? 1));
    utterance.volume = Math.max(0, Math.min(1, options.volume ?? 0.8));

    utterance.onstart = () => this.onStart();
    utterance.onend = () => this.onEnd();
    utterance.onpause = () => this.onPause();
    utterance.onresume = () => this.onResume();
    utterance.onerror = (e) => {
      // "interrupted" and "canceled" are normal when we call cancel() before speaking
      if (e.error === "interrupted" || e.error === "canceled") {
        this.onEnd();
        return;
      }
      this.onError(e.error);
    };

    this.synth.speak(utterance);
  }

  /** Speak the given text by appending to the queue instead of interrupting. */
  enqueue(text: string, options: TtsSpeakOptions = {}): void {
    if (!this.synth || !text.trim()) return;

    const utterance = new SpeechSynthesisUtterance(text);

    const targetURI = options.voiceURI ?? null;
    if (targetURI) {
      const voice = this.voices.find((v) => v.voiceURI === targetURI);
      if (voice) utterance.voice = voice;
    }

    utterance.rate = Math.max(0.1, Math.min(10, options.rate ?? 1));
    utterance.pitch = Math.max(0, Math.min(2, options.pitch ?? 1));
    utterance.volume = Math.max(0, Math.min(1, options.volume ?? 0.8));

    utterance.onstart = () => this.onStart();
    utterance.onend = () => this.onEnd();
    utterance.onpause = () => this.onPause();
    utterance.onresume = () => this.onResume();
    utterance.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") {
        this.onEnd();
        return;
      }
      this.onError(e.error);
    };

    this.synth.speak(utterance);
  }

  /** Pause current speech. */
  pause(): void {
    this.synth?.pause();
  }

  /** Resume paused speech. */
  resume(): void {
    this.synth?.resume();
  }

  /** Stop all speech and clear the queue. */
  stop(): void {
    this.synth?.cancel();
  }

  /** Whether the synth is currently speaking. */
  get isSpeaking(): boolean {
    return this.synth?.speaking ?? false;
  }

  /** Whether the synth is currently paused. */
  get isPaused(): boolean {
    return this.synth?.paused ?? false;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private serializeVoices(): TtsVoiceInfo[] {
    return this.voices.map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      isDefault: v.default,
    }));
  }
}

/** Singleton TTS engine instance. */
export const ttsEngine = new TtsEngine();
