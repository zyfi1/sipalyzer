import { describe, expect, it } from "vitest";
import { getTranscriptionSampleRate } from "@/lib/transcription";

describe("getTranscriptionSampleRate", () => {
  it("returns 16000 for G722 codec", () => {
    expect(getTranscriptionSampleRate("G722")).toBe(16000);
    expect(getTranscriptionSampleRate("g722")).toBe(16000);
  });

  it("returns 8000 for non-G722 codecs or empty values", () => {
    expect(getTranscriptionSampleRate("PCMU")).toBe(8000);
    expect(getTranscriptionSampleRate("PCMA")).toBe(8000);
    expect(getTranscriptionSampleRate(undefined)).toBe(8000);
    expect(getTranscriptionSampleRate("")).toBe(8000);
  });
});
