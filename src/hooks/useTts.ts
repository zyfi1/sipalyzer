import { useCallback } from "react";
import { useTtsStore } from "@/stores/ttsStore";
import { useShallow } from "zustand/react/shallow";

/**
 * Consumer hook for text-to-speech. Selects only the slices tools
 * typically need, avoiding unnecessary re-renders.
 *
 * Usage:
 * ```ts
 * const { speak, stop, speaking, enabled } = useTts();
 * speak("Incoming call from 555-1234");
 * ```
 */
export function useTts() {
  const { speaking, paused, enabled, currentText, speakAction, enqueueAction, stop, pause, resume } =
    useTtsStore(
      useShallow((s) => ({
        speaking: s.speaking,
        paused: s.paused,
        enabled: s.enabled,
        currentText: s.currentText,
        speakAction: s.speak,
        enqueueAction: s.enqueue,
        stop: s.stop,
        pause: s.pause,
        resume: s.resume,
      }))
    );

  const speak = useCallback(
    (text: string) => speakAction(text),
    [speakAction]
  );

  const enqueue = useCallback(
    (text: string) => enqueueAction(text),
    [enqueueAction]
  );

  return {
    /** Speak text (interrupt mode — cancels current). */
    speak,
    /** Speak text (queue mode — appends). */
    enqueue,
    /** Stop all speech. */
    stop,
    /** Pause current speech. */
    pause,
    /** Resume paused speech. */
    resume,
    /** Whether the engine is currently speaking. */
    speaking,
    /** Whether speech is paused. */
    paused,
    /** Whether TTS is globally enabled. */
    enabled,
    /** The text currently being spoken. */
    currentText,
  } as const;
}
