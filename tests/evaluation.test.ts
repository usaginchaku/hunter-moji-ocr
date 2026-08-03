import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import type { GlyphTemplateDefinition } from "../src/glyphs/types";
import { evaluateShiftRobustness, translateBinaryGlyph } from "../src/recognition/evaluation";
import { extractBasicFeatures, type BinaryGlyph } from "../src/recognition/features";

function makeTemplate(id: string, kana: string, pixels: number[]): LoadedGlyphTemplate {
  const binary: BinaryGlyph = { width: 3, height: 3, pixels: Uint8Array.from(pixels) };
  const definition: GlyphTemplateDefinition = {
    id,
    kana,
    direction: "horizontal",
    templatePath: `/glyphs/horizontal/${id}.svg`,
    width: 64,
    height: 64,
    status: "draft",
    supportsDakuten: false,
    supportsHandakuten: false,
    supportsSmallForm: false,
  };
  return { definition, binary, features: extractBasicFeatures(binary) };
}

describe("translateBinaryGlyph", () => {
  it("前景を画像外へ折り返さず移動する", () => {
    const source: BinaryGlyph = {
      width: 3,
      height: 2,
      pixels: Uint8Array.from([1, 0, 0, 0, 1, 0]),
    };
    expect(Array.from(translateBinaryGlyph(source, 1, 0).pixels)).toEqual([0, 1, 0, 0, 0, 1]);
  });

  it("小数の位置ずれを拒否する", () => {
    const source: BinaryGlyph = { width: 1, height: 1, pixels: Uint8Array.of(1) };
    expect(() => translateBinaryGlyph(source, 0.5, 0)).toThrow(
      "位置ずれ量は整数で指定してください。",
    );
  });
});

describe("evaluateShiftRobustness", () => {
  const diagonal = makeTemplate("diagonal", "あ", [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const horizontal = makeTemplate("horizontal", "い", [0, 0, 0, 1, 1, 1, 0, 0, 0]);

  it("無変形の自作字形を文字精度と完全一致率へ集計する", () => {
    const result = evaluateShiftRobustness([diagonal, horizontal], [{ x: 0, y: 0 }]);
    expect(result.correctCharacters).toBe(2);
    expect(result.characterAccuracy).toBe(1);
    expect(result.exactSequences).toBe(1);
    expect(result.sequenceExactRate).toBe(1);
  });

  it("空の評価セットを拒否する", () => {
    expect(() => evaluateShiftRobustness([], [{ x: 0, y: 0 }])).toThrow(
      "精度評価には字形と位置ずれ条件が必要です。",
    );
  });
});
