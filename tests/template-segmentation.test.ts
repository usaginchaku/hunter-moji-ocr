import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import type { GlyphTemplateDefinition } from "../src/glyphs/types";
import { extractBasicFeatures, type BinaryGlyph } from "../src/recognition/features";
import { detectHorizontalModifier } from "../src/recognition/modifier-detection";
import { normalizeBinaryGlyph } from "../src/recognition/normalize";
import type { TextSegment } from "../src/recognition/segment";
import { refineTextSegmentsWithTemplates } from "../src/recognition/template-segmentation";

function diagonal(reverse = false): BinaryGlyph {
  const pixels = new Uint8Array(8 * 8);
  for (let y = 0; y < 8; y += 1) pixels[y * 8 + (reverse ? 7 - y : y)] = 1;
  return { width: 8, height: 8, pixels };
}

function template(id: string, kana: string, source: BinaryGlyph): LoadedGlyphTemplate {
  const binary = normalizeBinaryGlyph(source);
  const definition: GlyphTemplateDefinition = {
    id,
    kana,
    direction: "horizontal",
    templatePath: `${id}.svg`,
    width: 64,
    height: 64,
    status: "ready",
    supportsDakuten: false,
    supportsHandakuten: false,
    supportsSmallForm: false,
  };
  return { definition, binary, features: extractBasicFeatures(binary) };
}

function segment(binary: BinaryGlyph): TextSegment {
  return {
    id: "0",
    lineIndex: 0,
    x: 10,
    y: 4,
    width: binary.width,
    height: binary.height,
    relativeHeight: 1,
    binary,
  };
}

describe("refineTextSegmentsWithTemplates", () => {
  const templates = [template("left", "あ", diagonal()), template("right", "い", diagonal(true))];

  it("接近して一候補になった2文字をテンプレート得点で再分割する", () => {
    const pixels = new Uint8Array(17 * 8);
    const left = diagonal();
    const right = diagonal(true);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        pixels[y * 17 + x] = left.pixels[y * 8 + x];
        pixels[y * 17 + 9 + x] = right.pixels[y * 8 + x];
      }
    }
    const result = refineTextSegmentsWithTemplates(
      [segment({ width: 17, height: 8, pixels })],
      templates,
    );
    expect(result).toHaveLength(2);
    expect(result.map(({ x, width }) => [x, width])).toEqual([
      [10, 8],
      [19, 8],
    ]);
  });

  it("高得点の単独字形は分割しない", () => {
    expect(refineTextSegmentsWithTemplates([segment(diagonal())], templates)).toHaveLength(1);
  });

  it("長音記号が左右へ割れた場合は専用テンプレートで再結合する", () => {
    const longMarkPixels = new Uint8Array(12 * 10);
    for (let y = 0; y < 10; y += 1) {
      longMarkPixels[y * 12 + 2 + Math.min(7, y)] = 1;
      longMarkPixels[y * 12 + 9 - Math.min(7, y)] = 1;
    }
    const longMark = { width: 12, height: 10, pixels: longMarkPixels };
    const longTemplate = template("long-vowel", "ー", longMark);
    const left = segment({
      width: 6,
      height: 10,
      pixels: Uint8Array.from(
        Array.from(
          { length: 10 * 6 },
          (_, index) => longMarkPixels[Math.floor(index / 6) * 12 + (index % 6)],
        ),
      ),
    });
    const right = segment({
      width: 6,
      height: 10,
      pixels: Uint8Array.from(
        Array.from(
          { length: 10 * 6 },
          (_, index) => longMarkPixels[Math.floor(index / 6) * 12 + 6 + (index % 6)],
        ),
      ),
    });
    right.x = left.x + 6;
    const result = refineTextSegmentsWithTemplates([left, right], [...templates, longTemplate]);
    expect(result).toHaveLength(1);
    expect(result[0].width).toBe(12);
  });

  it("別候補になった右下の半濁点を直前の文字へ再結合する", () => {
    const basePixels = new Uint8Array(14 * 20);
    for (let y = 1; y < 19; y += 1) {
      for (let x = 1; x < 4; x += 1) basePixels[y * 14 + x] = 1;
    }
    for (let y = 16; y < 19; y += 1) {
      for (let x = 1; x < 13; x += 1) basePixels[y * 14 + x] = 1;
    }
    const markPixels = new Uint8Array(8 * 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (x === 0 || x === 7 || y === 0 || y === 7) markPixels[y * 8 + x] = 1;
      }
    }
    const base = segment({ width: 14, height: 20, pixels: basePixels });
    const mark = segment({ width: 8, height: 8, pixels: markPixels });
    base.id = "base";
    mark.id = "mark";
    mark.x = base.x + base.width + 2;
    mark.y = base.y + 11;

    const result = refineTextSegmentsWithTemplates([base, mark], templates);

    expect(result).toHaveLength(1);
    expect(detectHorizontalModifier(result[0].binary).modifier).toBe("handakuten");
    expect(result[0].modifierAttachment).toMatchObject({
      baseSourceId: "base",
      markSourceId: "mark",
      modifier: "handakuten",
    });
    expect(result[0].modifierAttachment?.baseBinary).toBe(base.binary);
    expect(result[0].modifierAttachment?.markBinary).toBe(mark.binary);
  });
});
