import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import type { GlyphTemplateDefinition } from "../src/glyphs/types";
import { extractBasicFeatures, type BinaryGlyph } from "../src/recognition/features";
import { rankGlyphCandidates, scoreGlyph } from "../src/recognition/similarity";

function makeTemplate(id: string, kana: string, pixels: number[]): LoadedGlyphTemplate {
  const binary: BinaryGlyph = {
    width: 3,
    height: 3,
    pixels: Uint8Array.from(pixels),
  };
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

const diagonal = makeTemplate("diagonal", "あ", [1, 0, 0, 0, 1, 0, 0, 0, 1]);
const horizontal = makeTemplate("horizontal", "い", [0, 0, 0, 1, 1, 1, 0, 0, 0]);
const vertical = makeTemplate("vertical", "う", [0, 1, 0, 0, 1, 0, 0, 1, 0]);

describe("scoreGlyph", () => {
  it("同一字形を満点として評価する", () => {
    const candidate = scoreGlyph(diagonal, diagonal);
    expect(candidate.score).toBe(1);
    expect(candidate.scoreBreakdown).toEqual({
      bitmap: 1,
      projection: 1,
      aspectRatio: 1,
      foreground: 1,
      components: 1,
      spatial: 1,
    });
  });

  it("異なる字形のビットマップ評価を下げる", () => {
    expect(scoreGlyph(diagonal, horizontal).scoreBreakdown.bitmap).toBeLessThan(1);
  });

  it("正規化後の2px以内の位置ずれを吸収する", () => {
    const source = makeTemplate("source", "あ", [1, 0, 0, 0, 1, 0, 0, 0, 0]);
    const shifted = makeTemplate("shifted", "あ", [0, 1, 0, 0, 0, 1, 0, 0, 0]);

    expect(scoreGlyph(source, shifted).scoreBreakdown.bitmap).toBe(1);
  });

  it("位置合わせで画像外へ出る余分な画素もunionへ数える", () => {
    const source = makeTemplate("source", "あ", [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const extra = makeTemplate("extra", "あ", [0, 1, 1, 0, 0, 0, 0, 0, 0]);

    expect(scoreGlyph(source, extra).scoreBreakdown.bitmap).toBe(0.5);
  });
});

describe("rankGlyphCandidates", () => {
  it("得点順で上位3候補を返す", () => {
    const candidates = rankGlyphCandidates(diagonal, [horizontal, diagonal, vertical]);
    expect(candidates).toHaveLength(3);
    expect(candidates[0].templateId).toBe("diagonal");
    expect(candidates[0].score).toBe(1);
  });

  it("候補数を制限できる", () => {
    expect(rankGlyphCandidates(diagonal, [horizontal, diagonal, vertical], 2)).toHaveLength(2);
  });

  it("不正な候補数を拒否する", () => {
    expect(() => rankGlyphCandidates(diagonal, [diagonal], 0)).toThrow(
      "候補数は1以上の整数で指定してください。",
    );
  });
});
