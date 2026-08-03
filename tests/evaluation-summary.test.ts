import { describe, expect, it } from "vitest";
import { summarizeEvaluationRecords } from "../src/recognition/evaluation-summary";

describe("summarizeEvaluationRecords", () => {
  it("保存済み画像の精度と候補数比率を集計する", () => {
    const summary = summarizeEvaluationRecords([
      { expectedCharacters: 4, predictedCharacters: 5, editDistance: 1, exactMatch: false },
      { expectedCharacters: 2, predictedCharacters: 2, editDistance: 0, exactMatch: true },
    ]);

    expect(summary).toMatchObject({
      imageCount: 2,
      expectedCharacters: 6,
      predictedCharacters: 7,
      correctCharacters: 5,
      exactMatchCount: 1,
    });
    expect(summary.characterAccuracy).toBeCloseTo(5 / 6);
    expect(summary.exactMatchRate).toBe(0.5);
    expect(summary.segmentationRatio).toBeCloseTo(7 / 6);
  });

  it("記録がない場合は0で集計する", () => {
    expect(summarizeEvaluationRecords([])).toMatchObject({
      imageCount: 0,
      characterAccuracy: 0,
      exactMatchRate: 0,
      segmentationRatio: 0,
    });
  });

  it("編集距離が正解文字数を超えても正解文字数を負数へしない", () => {
    const summary = summarizeEvaluationRecords([
      { expectedCharacters: 2, predictedCharacters: 6, editDistance: 5, exactMatch: false },
      { expectedCharacters: 1, predictedCharacters: 1, editDistance: 0, exactMatch: true },
    ]);

    expect(summary.correctCharacters).toBe(1);
    expect(summary.characterAccuracy).toBeCloseTo(1 / 3);
  });

  it("文字数一致画像だけのTop-1・Top-3と修飾別精度を集計する", () => {
    const summary = summarizeEvaluationRecords([
      {
        expectedCharacters: 3,
        predictedCharacters: 3,
        editDistance: 2,
        exactMatch: false,
        segmentationExact: true,
        alignedCharacters: 3,
        top1Correct: 1,
        top3Correct: 2,
        categoryCounts: {
          dakuten: { total: 1, top1Correct: 0, top3Correct: 1 },
          handakuten: { total: 1, top1Correct: 1, top3Correct: 1 },
          small: { total: 1, top1Correct: 0, top3Correct: 0 },
        },
      },
      {
        expectedCharacters: 3,
        predictedCharacters: 2,
        editDistance: 1,
        exactMatch: false,
        segmentationExact: false,
        alignedCharacters: 0,
        top1Correct: 0,
        top3Correct: 0,
        categoryCounts: {
          dakuten: { total: 0, top1Correct: 0, top3Correct: 0 },
          handakuten: { total: 0, top1Correct: 0, top3Correct: 0 },
          small: { total: 0, top1Correct: 0, top3Correct: 0 },
        },
      },
    ]);

    expect(summary).toMatchObject({
      detailedImageCount: 2,
      segmentationExactCount: 1,
      alignedCharacters: 3,
      top1Correct: 1,
      top3Correct: 2,
    });
    expect(summary.segmentationExactRate).toBe(0.5);
    expect(summary.top1Accuracy).toBeCloseTo(1 / 3);
    expect(summary.top3Accuracy).toBeCloseTo(2 / 3);
    expect(summary.categories.dakuten.top3Accuracy).toBe(1);
    expect(summary.categories.small.top1Accuracy).toBe(0);
  });

  it("矛盾した詳細指標を集計へ混ぜない", () => {
    const summary = summarizeEvaluationRecords([
      {
        expectedCharacters: 2,
        predictedCharacters: 2,
        editDistance: 0,
        exactMatch: true,
        segmentationExact: true,
        alignedCharacters: 2,
        top1Correct: 3,
        top3Correct: 3,
        categoryCounts: {
          dakuten: { total: 0, top1Correct: 0, top3Correct: 0 },
          handakuten: { total: 0, top1Correct: 0, top3Correct: 0 },
          small: { total: 0, top1Correct: 0, top3Correct: 0 },
        },
      },
    ]);

    expect(summary.detailedImageCount).toBe(0);
    expect(summary.top1Accuracy).toBe(0);
  });
});
