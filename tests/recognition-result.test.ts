import { describe, expect, it } from "vitest";
import {
  resolveGlyphOutput,
  resolveGlyphModifier,
  resolveGlyphSize,
  type RecognizedGlyphResult,
} from "../src/domain/recognition-result";

describe("recognition result", () => {
  it("自動指定では画像処理が判定したサイズを採用する", () => {
    expect(resolveGlyphSize("auto", "small")).toBe("small");
    expect(resolveGlyphOutput("つ", "auto", "small", null)).toMatchObject({
      kana: "っ",
      size: "small",
      sizeApplied: true,
    });
  });

  it("小書きの自動判定をユーザーが通常文字へ戻せる", () => {
    expect(resolveGlyphOutput("つ", "normal", "small", null)).toEqual({
      baseKana: "つ",
      kana: "つ",
      size: "normal",
      sizeApplied: false,
      sizeSupported: true,
      modifierApplied: null,
    });
  });

  it("通常判定をユーザーが小書きへ変更できる", () => {
    expect(resolveGlyphOutput("よ", "small", "normal", null)).toMatchObject({
      kana: "ょ",
      size: "small",
      sizeApplied: true,
      sizeSupported: true,
    });
  });

  it("母音の通常判定をユーザーが小書きへ変更できる", () => {
    expect(resolveGlyphOutput("い", "small", "normal", null)).toMatchObject({
      kana: "ぃ",
      size: "small",
      sizeApplied: true,
      sizeSupported: true,
    });
  });

  it("小書き非対応の基底文字を推測で変換しない", () => {
    expect(resolveGlyphOutput("か", "small", "normal", null)).toMatchObject({
      kana: "か",
      size: "small",
      sizeApplied: false,
      sizeSupported: false,
    });
  });

  it("修飾記号が有効な場合は合成結果を優先する", () => {
    expect(resolveGlyphOutput("は", "auto", "small", "handakuten")).toMatchObject({
      kana: "ぱ",
      size: "normal",
      sizeApplied: false,
      modifierApplied: "handakuten",
    });
  });

  it("自動判定とユーザー指定を別フィールドとして保持できる", () => {
    const result: RecognizedGlyphResult = {
      id: "segment-0",
      lineIndex: 0,
      bbox: { x: 10, y: 4, width: 14, height: 14 },
      candidates: [{ templateId: "tsu", kana: "つ", score: 0.82 }],
      automaticBaseKana: "つ",
      selectedBaseKana: "つ",
      baseSelection: "manual",
      automaticSize: "small",
      automaticSizeAmbiguous: false,
      sizeSelection: "normal",
      detectedModifier: null,
      modifierConfidence: 0,
      modifierSelection: "none",
      modifierAssociation: null,
    };

    expect(result.automaticSize).toBe("small");
    expect(result.baseSelection).toBe("manual");
    expect(result.sizeSelection).toBe("normal");
    expect(result.modifierSelection).toBe("none");
    expect(result.modifierAssociation).toBeNull();
  });
});

describe("modifier selection", () => {
  it("自動指定ではしきい値以上の検出結果を採用する", () => {
    expect(resolveGlyphModifier("auto", "dakuten", 0.7)).toBe("dakuten");
    expect(resolveGlyphModifier("auto", "dakuten", 0.69)).toBeNull();
  });

  it("ユーザーのなし指定は自動検出より優先される", () => {
    expect(resolveGlyphModifier("none", "handakuten", 0.95)).toBeNull();
  });

  it("ユーザーが明示した修飾記号を採用する", () => {
    expect(resolveGlyphModifier("handakuten", null, 0)).toBe("handakuten");
  });

  it("不正な信頼度としきい値を拒否する", () => {
    expect(() => resolveGlyphModifier("auto", "dakuten", 1.1)).toThrow(
      "修飾記号の信頼度は0以上1以下で指定してください。",
    );
    expect(() => resolveGlyphModifier("auto", "dakuten", 0.8, -0.1)).toThrow(
      "修飾記号の自動確定しきい値は0以上1以下で指定してください。",
    );
  });
});
