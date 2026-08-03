import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import type { GlyphTemplateDefinition } from "../src/glyphs/types";
import { summarizeEvaluationRecords } from "../src/recognition/evaluation-summary";
import { extractBasicFeatures } from "../src/recognition/features";
import { evaluateTranscription } from "../src/recognition/label-evaluation";
import { normalizeBinaryGlyph } from "../src/recognition/normalize";
import { segmentHorizontalText } from "../src/recognition/segment";
import { rankGlyphCandidates } from "../src/recognition/similarity";
import {
  PUBLIC_EVALUATION_CASES,
  PUBLIC_EVALUATION_GLYPHS,
} from "./fixtures/public-evaluation-set";

const templates: readonly LoadedGlyphTemplate[] = PUBLIC_EVALUATION_GLYPHS.map((glyph) => {
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

function recognize(image: (typeof PUBLIC_EVALUATION_CASES)[number]["image"]): string {
  const segmentation = segmentHorizontalText(image, {
    minComponentArea: 1,
    minLineHeight: 2,
    maxInternalGapRatio: 0.12,
    applyOpening: false,
  });
  const lines = new Map<number, string[]>();
  for (const segment of segmentation.segments) {
    const binary = normalizeBinaryGlyph(segment.binary);
    const candidate = rankGlyphCandidates(
      { binary, features: extractBasicFeatures(binary) },
      templates,
      1,
    )[0];
    const values = lines.get(segment.lineIndex) ?? [];
    values.push(candidate?.kana ?? "?");
    lines.set(segment.lineIndex, values);
  }
  return [...lines.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, values]) => values.join(""))
    .join("\n");
}

describe("公開可能な自作画像の回帰評価", () => {
  it("文字精度・完全一致率・分割比率の最低基準を維持する", () => {
    const results = PUBLIC_EVALUATION_CASES.map((testCase) => {
      const predicted = recognize(testCase.image);
      const evaluation = evaluateTranscription(predicted, testCase.expected);
      return {
        id: testCase.id,
        predicted,
        expected: testCase.expected,
        record: {
          expectedCharacters: evaluation.expectedCharacters,
          predictedCharacters: predicted.replaceAll("\n", "").length,
          editDistance: evaluation.editDistance,
          exactMatch: evaluation.exactMatch,
        },
      };
    });
    const summary = summarizeEvaluationRecords(results.map(({ record }) => record));

    expect(results, JSON.stringify(results, null, 2)).toHaveLength(4);
    expect(summary.characterAccuracy).toBe(1);
    expect(summary.exactMatchRate).toBe(1);
    expect(summary.segmentationRatio).toBe(1);
  });
});
