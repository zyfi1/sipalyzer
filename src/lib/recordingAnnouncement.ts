let lastAnnouncementMs = 0;
let recordingOnAudio: HTMLAudioElement | null = null;

function getRecordingOnAudio(): HTMLAudioElement {
  if (!recordingOnAudio) {
    recordingOnAudio = new Audio("/audio/recording-on.wav");
    recordingOnAudio.preload = "auto";
  }
  return recordingOnAudio;
}

function speakFallbackAnnouncement(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance("recording on");
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Best effort only.
  }
}

/**
 * Plays legal disclosure prompt before call recording starts.
 * Tries pre-recorded asset first; falls back to speech synthesis.
 */
export async function playRecordingOnAnnouncement(): Promise<void> {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (now - lastAnnouncementMs < 1200) return;
  lastAnnouncementMs = now;

  const audio = getRecordingOnAudio();
  audio.pause();
  audio.currentTime = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Unable to play recording announcement audio."));
      };
      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch((err) => {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    });
  } catch {
    speakFallbackAnnouncement();
  }
}
