import { create } from "zustand";
import { ttsEngine, type TtsVoiceInfo } from "@/lib/ttsEngine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Persisted TTS settings (saved to session state). */
export interface TtsSettings {
  /** Selected voice URI, or null for system default. */
  voiceURI: string | null;
  /** Speech rate (0.5–2.0). */
  rate: number;
  /** Voice pitch (0.5–1.5). */
  pitch: number;
  /** TTS volume (0–1). */
  volume: number;
  /** Global TTS on/off toggle. */
  enabled: boolean;
}

export interface TtsState extends TtsSettings {
  // --- Runtime state (not persisted) ---
  /** Whether the engine is currently speaking. */
  speaking: boolean;
  /** Whether speech is paused. */
  paused: boolean;
  /** Available system voices (loaded at init). */
  availableVoices: TtsVoiceInfo[];
  /** Text currently being spoken, or null. */
  currentText: string | null;

  // --- Actions ---
  /** Speak the given text (interrupt mode — cancels current speech). */
  speak: (text: string) => void;
  /** Speak the given text (queue mode — appends to queue). */
  enqueue: (text: string) => void;
  /** Stop all speech. */
  stop: () => void;
  /** Pause current speech. */
  pause: () => void;
  /** Resume paused speech. */
  resume: () => void;
  /** Load available voices from the system. Called once at app init. */
  loadVoices: () => Promise<void>;
  /** Update the selected voice. */
  setVoice: (uri: string | null) => void;
  /** Update the speech rate. */
  setRate: (rate: number) => void;
  /** Update the voice pitch. */
  setPitch: (pitch: number) => void;
  /** Update the TTS volume. */
  setVolume: (volume: number) => void;
  /** Toggle TTS on/off. */
  setEnabled: (enabled: boolean) => void;
  /** Reset all settings to defaults. */
  resetSettings: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const defaultTtsSettings: TtsSettings = {
  voiceURI: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 0.8,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTtsStore = create<TtsState>()((set, get) => {
  // Wire engine callbacks to update store runtime state
  ttsEngine.onStart = () => set({ speaking: true, paused: false });
  ttsEngine.onEnd = () => set({ speaking: false, paused: false, currentText: null });
  ttsEngine.onPause = () => set({ paused: true });
  ttsEngine.onResume = () => set({ paused: false });
  ttsEngine.onError = (error) => {
    console.warn("[TTS] Speech error:", error);
    set({ speaking: false, paused: false, currentText: null });
  };

  return {
    // Persisted settings
    ...defaultTtsSettings,

    // Runtime state
    speaking: false,
    paused: false,
    availableVoices: [],
    currentText: null,

    // Actions
    speak: (text: string) => {
      const state = get();
      if (!state.enabled || !text.trim()) return;
      set({ currentText: text });
      ttsEngine.speak(text, {
        voiceURI: state.voiceURI,
        rate: state.rate,
        pitch: state.pitch,
        volume: state.volume,
      });
    },

    enqueue: (text: string) => {
      const state = get();
      if (!state.enabled || !text.trim()) return;
      set({ currentText: text });
      ttsEngine.enqueue(text, {
        voiceURI: state.voiceURI,
        rate: state.rate,
        pitch: state.pitch,
        volume: state.volume,
      });
    },

    stop: () => {
      ttsEngine.stop();
      set({ speaking: false, paused: false, currentText: null });
    },

    pause: () => {
      ttsEngine.pause();
    },

    resume: () => {
      ttsEngine.resume();
    },

    loadVoices: async () => {
      const voices = await ttsEngine.loadVoices();
      set({ availableVoices: voices });
    },

    setVoice: (uri) => set({ voiceURI: uri }),
    setRate: (rate) => set({ rate: Math.max(0.5, Math.min(2.0, rate)) }),
    setPitch: (pitch) => set({ pitch: Math.max(0.5, Math.min(1.5, pitch)) }),
    setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
    setEnabled: (enabled) => {
      if (!enabled) {
        ttsEngine.stop();
        set({ enabled, speaking: false, paused: false, currentText: null });
      } else {
        set({ enabled });
      }
    },

    resetSettings: () => {
      ttsEngine.stop();
      set({ ...defaultTtsSettings, speaking: false, paused: false, currentText: null });
    },
  };
});
