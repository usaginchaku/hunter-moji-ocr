import { describe, expect, it } from "vitest";
import { assessRecognitionReview } from "../src/domain/recognition-review";

function result(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      { templateId: "ka", kana: "か", score: 0.8 },
      { templateId: "ki", kana: "き", score: 0.6 },
    ],
    baseSelection: "auto" as const,
    sizeSelection: "auto" as const,
    automaticSizeAmbiguous: false,
    detectedModifier: null,
    modifierConfidence: 0,
    modifierSelection: "auto" as const,
    ...overrides,
  };
}

describe("assessRecognitionReview", () => {
  it("十分な得点差がある自動結果を確認済みにする", () => {
    expect(assessRecognitionReview(result())).toMatchObject({ state: "accepted", reasons: [] });
  });

  it("低得点・僅差・サイズ境界・修飾境界をまとめて要確認にする", () => {
    expect(
      assessRecognitionReview(
        result({
          candidates: [
            { templateId: "ka", kana: "か", score: 0.6 },
            { templateId: "ki", kana: "き", score: 0.56 },
          ],
          automaticSizeAmbiguous: true,
          detectedModifier: "dakuten",
          modifierConfidence: 0.62,
        }),
      ),
    ).toMatchObject({
      state: "needs-review",
      reasons: ["low-base-score", "close-base-candidates", "ambiguous-size", "ambiguous-modifier"],
    });
  });

  it("ユーザーが明示した項目は自動判定の要確認理由から外す", () => {
    expect(
      assessRecognitionReview(
        result({
          candidates: [
            { templateId: "ka", kana: "か", score: 0.4 },
            { templateId: "ki", kana: "き", score: 0.39 },
          ],
          baseSelection: "manual",
          sizeSelection: "normal",
          automaticSizeAmbiguous: true,
          detectedModifier: "dakuten",
          modifierConfidence: 0.6,
          modifierSelection: "none",
        }),
      ),
    ).toMatchObject({ state: "accepted", reasons: [] });
  });

  it("候補がなければ未認識にする", () => {
    expect(assessRecognitionReview(result({ candidates: [] }))).toMatchObject({
      state: "unrecognized",
      reasons: ["no-candidate"],
    });
  });
});
