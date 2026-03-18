export function getTranscriptionSampleRate(codec?: string): number {
  const normalized = codec?.trim().toUpperCase() ?? "";
  if (normalized === "G722" || normalized === "G.722" || normalized.startsWith("G722/")) {
    return 16000;
  }
  return 8000;
}
