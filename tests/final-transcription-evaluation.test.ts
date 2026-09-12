import { describe, expect, it } from "vitest";
import { evaluateFinalTranscription } from "../src/recognition/final-transcription-evaluation";

describe("final transcription acceptance metrics", () => {
  it("retains all expected categories when OCR is empty or missing characters", () => {
    expect(evaluateFinalTranscription("がぽっ", "")).toMatchObject({
      editDistance: 3,
      expectedCharacters: 3,
      categories: {
        dakuten: { total: 1, correct: 0 },
        handakuten: { total: 1, correct: 0 },
        small: { total: 1, correct: 0 },
      },
    });
    expect(evaluateFinalTranscription("あがぽっ", "がっ").categories).toEqual({
      dakuten: { total: 1, correct: 1 },
      handakuten: { total: 1, correct: 0 },
      small: { total: 1, correct: 1 },
    });
  });

  it("requires the correct base character as well as a dakuten", () => {
    expect(evaluateFinalTranscription("がぎ", "かぐ")).toMatchObject({
      categories: { dakuten: { total: 2, correct: 0 } },
      incorrectDakutenOutputs: 1,
      spuriousDakutenOutputs: 0,
    });
  });

  it("counts extra dakuten outputs separately without changing the expected denominator", () => {
    expect(evaluateFinalTranscription("あがう", "ざあがう")).toMatchObject({
      editDistance: 1,
      categories: { dakuten: { total: 1, correct: 1 } },
      incorrectDakutenOutputs: 1,
      spuriousDakutenOutputs: 1,
    });
  });

  it("does not maximize the dakuten count across tied edit alignments", () => {
    expect(evaluateFinalTranscription("がか", "かが")).toMatchObject({
      editDistance: 2,
      categories: { dakuten: { total: 1, correct: 0 } },
    });
  });

  it("requires line breaks for image exact match and keeps zero-character inputs defined", () => {
    expect(evaluateFinalTranscription("が\nぎ", "がぎ")).toMatchObject({
      editDistance: 0,
      exactMatch: false,
      categories: { dakuten: { total: 2, correct: 2 } },
    });
    expect(evaluateFinalTranscription("", "")).toMatchObject({
      exactMatch: true,
      expectedCharacters: 0,
    });
    expect(evaluateFinalTranscription("", "が")).toMatchObject({
      exactMatch: false,
      incorrectDakutenOutputs: 1,
      spuriousDakutenOutputs: 1,
    });
  });

  it("bounds the edit-alignment matrix", () => {
    expect(() => evaluateFinalTranscription("あ".repeat(1000), "あ".repeat(1000))).toThrow(
      "大きすぎます",
    );
  });
});
