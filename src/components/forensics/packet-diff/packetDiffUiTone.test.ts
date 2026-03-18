import { describe, expect, it } from "vitest";
import {
  fieldStatusToneClasses,
  rowStatusMarkerClasses,
  rowStatusToneClasses,
} from "./packetDiffUiTone";

describe("packetDiffUiTone", () => {
  it("maps row statuses to readable diff tones", () => {
    expect(rowStatusToneClasses("exact")).toContain("border-success");
    expect(rowStatusToneClasses("changed")).toContain("border-warning");
    expect(rowStatusToneClasses("left_only")).toContain("border-destructive");
    expect(rowStatusToneClasses("right_only")).toContain("border-success");
    expect(rowStatusToneClasses("exact")).not.toContain("bg-");
    expect(rowStatusToneClasses("changed")).not.toContain("bg-");
    expect(rowStatusToneClasses("left_only")).not.toContain("bg-");
    expect(rowStatusToneClasses("right_only")).not.toContain("bg-");
  });

  it("maps field statuses to readable diff tones", () => {
    expect(fieldStatusToneClasses("same")).toContain("text-muted-foreground");
    expect(fieldStatusToneClasses("changed")).toContain("text-warning");
    expect(fieldStatusToneClasses("left_only")).toContain("text-destructive");
    expect(fieldStatusToneClasses("right_only")).toContain("text-success");
    expect(fieldStatusToneClasses("same")).not.toContain("bg-");
    expect(fieldStatusToneClasses("changed")).toContain("border-warning");
    expect(fieldStatusToneClasses("left_only")).toContain("border-destructive");
    expect(fieldStatusToneClasses("right_only")).toContain("border-success");
  });

  it("maps row statuses to marker accent classes", () => {
    expect(rowStatusMarkerClasses("exact")).toContain("bg-success");
    expect(rowStatusMarkerClasses("changed")).toContain("bg-warning");
    expect(rowStatusMarkerClasses("left_only")).toContain("bg-destructive");
    expect(rowStatusMarkerClasses("right_only")).toContain("bg-success");
  });
});
