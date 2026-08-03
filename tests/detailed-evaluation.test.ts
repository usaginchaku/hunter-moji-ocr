import { describe, expect, it } from "vitest";
import {
  compareEvaluationDistance,
  evaluateDetailedRecognition,
} from "../src/recognition/detailed-evaluation";

describe("evaluateDetailedRecognition", () => {
  it("文字数一致画像だけでTop-1・Top-3と修飾別精度を集計する", () => {
    const result = evaluateDetailedRecognition("がぽっ", "かぽつ", [
      ["か", "が", "き"],
      ["ぽ", "ほ", "ぼ"],
      ["つ", "っ", "す"],
    ]);

    expect(result).toMatchObject({
      segmentationExact: true,
      alignedCharacters: 3,
      top1Correct: 1,
      top3Correct: 3,
      categories: {
        dakuten: { total: 1, top1Correct: 0, top3Correct: 1 },
        handakuten: { total: 1, top1Correct: 1, top3Correct: 1 },
        small: { total: 1, top1Correct: 0, top3Correct: 1 },
      },
    });
  });

  it("文字数が違う画像を位置対応した字形精度へ混ぜない", () => {
    expect(evaluateDetailedRecognition("あいう", "あう", [["あ"], ["う"]])).toMatchObject({
      segmentationExact: false,
      alignedCharacters: 0,
      top1Correct: 0,
      top3Correct: 0,
    });
  });

  it("認識文字と候補一覧の数が違う入力を拒否する", () => {
    expect(() => evaluateDetailedRecognition("あ", "あ", [])).toThrow(
      "認識文字数と候補一覧の数が一致しません。",
    );
  });
});

describe("compareEvaluationDistance", () => {
  it("旧版からの改善・悪化・同値を分類する", () => {
    expect(compareEvaluationDistance(3, 2)).toBe("improved");
    expect(compareEvaluationDistance(2, 3)).toBe("regressed");
    expect(compareEvaluationDistance(2, 2)).toBe("unchanged");
  });
});
