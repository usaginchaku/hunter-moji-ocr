import { describe, expect, it } from "vitest";
import {
  scoreRecognitionVariant,
  selectBestRecognitionVariant,
} from "../src/recognition/variant-selection";

describe("recognition variant selection", () => {
  it("複数行かつ過剰な候補数の方式を自動選択しない", () => {
    const plausible = {
      id: "plausible",
      candidateScores: [0.62, 0.64, 0.61],
      candidateMargins: [0.08, 0.09, 0.07],
      lineCount: 1,
      sourceAspectRatio: 2,
    };
    const oversegmented = {
      id: "oversegmented",
      candidateScores: Array.from({ length: 40 }, () => 0.78),
      candidateMargins: Array.from({ length: 40 }, () => 0.12),
      lineCount: 3,
      sourceAspectRatio: 2,
    };

    expect(selectBestRecognitionVariant([oversegmented, plausible])?.id).toBe("plausible");
  });

  it("テンプレート一致度と候補差が高い方式を選ぶ", () => {
    const selected = selectBestRecognitionVariant([
      { id: "noisy", candidateScores: [0.58, 0.57], candidateMargins: [0.01, 0.01] },
      { id: "local", candidateScores: [0.72, 0.69], candidateMargins: [0.09, 0.07] },
    ]);
    expect(selected?.id).toBe("local");
  });

  it("候補がない方式は選ばない", () => {
    expect(
      scoreRecognitionVariant({ id: "empty", candidateScores: [], candidateMargins: [] }),
    ).toBe(Number.NEGATIVE_INFINITY);
  });

  it("背景ノイズ由来の過剰な構造判定を選択時に減点する", () => {
    const selected = selectBestRecognitionVariant([
      {
        id: "noisy",
        candidateScores: [0.72, 0.7],
        candidateMargins: [0.04, 0.04],
        structurePenalty: 0.05,
      },
      { id: "clean", candidateScores: [0.7, 0.69], candidateMargins: [0.04, 0.04] },
    ]);
    expect(selected?.id).toBe("clean");
  });

  it("同じ文字だけへ極端に偏る高得点結果を除外する", () => {
    const selected = selectBestRecognitionVariant([
      {
        id: "collapsed",
        candidateScores: [0.92, 0.91, 0.93],
        candidateMargins: [0.2, 0.2, 0.2],
        dominantCandidateShare: 1,
      },
      {
        id: "varied",
        candidateScores: [0.72, 0.7, 0.71],
        candidateMargins: [0.05, 0.04, 0.05],
        dominantCandidateShare: 1 / 3,
      },
    ]);

    expect(selected?.id).toBe("varied");
  });

  it("横長画像で極端に文字数が少ない方式を軽く減点する", () => {
    const selected = selectBestRecognitionVariant([
      {
        id: "collapsed",
        candidateScores: [0.73, 0.72],
        candidateMargins: [0.04, 0.04],
        sourceAspectRatio: 3.2,
      },
      {
        id: "plausible",
        candidateScores: [0.7, 0.69, 0.68, 0.67],
        candidateMargins: [0.04, 0.04, 0.04, 0.04],
        sourceAspectRatio: 3.2,
      },
    ]);

    expect(selected?.id).toBe("plausible");
  });

  it("単文字に近い画像の候補数は減点しない", () => {
    expect(
      scoreRecognitionVariant({
        id: "single",
        candidateScores: [0.72],
        candidateMargins: [0.08],
        sourceAspectRatio: 1.2,
      }),
    ).toBeCloseTo(0.747, 6);
  });

  it("中程度の横長画像を1文字とした方式には不足ペナルティを付けない", () => {
    expect(
      scoreRecognitionVariant({
        id: "wide-single",
        candidateScores: [0.72],
        candidateMargins: [0.08],
        sourceAspectRatio: 2.4,
      }),
    ).toBeCloseTo(0.747, 6);
  });

  it("方式間の候補数中央値より極端に少な崩れ方式を避ける", () => {
    const selected = selectBestRecognitionVariant([
      {
        id: "collapsed",
        candidateScores: [0.76, 0.75],
        candidateMargins: [0.06, 0.06],
        sourceAspectRatio: 2.1,
      },
      {
        id: "four-a",
        candidateScores: [0.68, 0.68, 0.68, 0.68],
        candidateMargins: [0.04, 0.04, 0.04, 0.04],
        sourceAspectRatio: 2.1,
      },
      {
        id: "four-b",
        candidateScores: [0.69, 0.69, 0.69, 0.69],
        candidateMargins: [0.04, 0.04, 0.04, 0.04],
        sourceAspectRatio: 2.1,
      },
    ]);

    expect(selected?.id).toBe("four-b");
  });

  it("他方式がノイズで増えても単一候補は保護する", () => {
    const selected = selectBestRecognitionVariant([
      { id: "single", candidateScores: [0.8], candidateMargins: [0.1] },
      {
        id: "noisy-a",
        candidateScores: [0.55, 0.55, 0.55],
        candidateMargins: [0.01, 0.01, 0.01],
      },
      {
        id: "noisy-b",
        candidateScores: [0.54, 0.54, 0.54],
        candidateMargins: [0.01, 0.01, 0.01],
      },
    ]);

    expect(selected?.id).toBe("single");
  });
});
