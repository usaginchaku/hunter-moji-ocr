import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import type { GlyphTemplateDefinition } from "../src/glyphs/types";
import { extractBasicFeatures } from "../src/recognition/features";
import { normalizeBinaryGlyph } from "../src/recognition/normalize";
import { runRecognitionPipeline } from "../src/recognition/recognition-pipeline";
import {
  PUBLIC_EVALUATION_CASES,
  PUBLIC_EVALUATION_GLYPHS,
} from "./fixtures/public-evaluation-set";

const templates: LoadedGlyphTemplate[] = PUBLIC_EVALUATION_GLYPHS.map((glyph) => {
  const binary = normalizeBinaryGlyph(glyph.binary);
  const definition: GlyphTemplateDefinition = {
    id: glyph.id,
    kana: glyph.kana,
    direction: "horizontal",
    templatePath: `self-made://${glyph.id}`,
    width: 64,
    height: 64,
    status: "ready",
    supportsDakuten: false,
    supportsHandakuten: false,
    supportsSmallForm: false,
  };
  return { definition, binary, features: extractBasicFeatures(binary) };
});

describe("recognition pipeline", () => {
  it("Workerへ移すパイプラインでも読順と上位候補を維持する", () => {
    const testCase = PUBLIC_EVALUATION_CASES[0];
    const result = runRecognitionPipeline(
      [{ mode: "background", label: "背景色との差", binary: testCase.image }],
      templates,
      "auto",
    );
    const text = result.selected?.recognized.map((item) => item.candidates[0]?.kana).join("");

    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.selected?.refinedCandidateCount).toBe(3);
    expect(text).toBe(testCase.expected);
  });

  it("手動方式では下線補正版ではなく指定方式の通常結果を選ぶ", () => {
    const testCase = PUBLIC_EVALUATION_CASES[1];
    const result = runRecognitionPipeline(
      [{ mode: "background", label: "背景色との差", binary: testCase.image }],
      templates,
      "background",
    );

    expect(result.selected?.id).toBe("background");
  });
});
