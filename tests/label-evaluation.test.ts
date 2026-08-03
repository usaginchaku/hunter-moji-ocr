import { describe, expect, it } from "vitest";
import {
  evaluateTranscription,
  levenshteinDistance,
  normalizeTranscription,
} from "../src/recognition/label-evaluation";

describe("normalizeTranscription", () => {
  it("改行を統一し、評価に不要な空白と空行を除く", () => {
    expect(normalizeTranscription(" あ い\r\n\r\nう　え ")).toBe("あい\nうえ");
  });
});

describe("levenshteinDistance", () => {
  it("挿入・削除・置換を数える", () => {
    expect(levenshteinDistance("かな", "かんな")).toBe(1);
    expect(levenshteinDistance("かき", "かく")).toBe(1);
  });
});

describe("evaluateTranscription", () => {
  it("文字精度と行完全一致率を算出する", () => {
    expect(evaluateTranscription("あい\nうお", "あい\nうえ")).toMatchObject({
      characterAccuracy: 0.75,
      exactLineRate: 0.5,
      exactMatch: false,
      editDistance: 1,
      expectedCharacters: 4,
    });
  });

  it("全文一致を判定する", () => {
    expect(evaluateTranscription("がっこう", "がっこう")).toMatchObject({
      characterAccuracy: 1,
      exactLineRate: 1,
      exactMatch: true,
    });
  });
});
