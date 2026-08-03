import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import { extractBasicFeatures, type BinaryGlyph } from "./features";
import { rankGlyphCandidates } from "./similarity";

export interface EvaluationOffset {
  x: number;
  y: number;
}

export interface RecognitionEvaluation {
  totalCharacters: number;
  correctCharacters: number;
  characterAccuracy: number;
  totalSequences: number;
  exactSequences: number;
  sequenceExactRate: number;
  uncertainCharacters: number;
  uncertainRate: number;
}

export const DEFAULT_EVALUATION_OFFSETS: readonly EvaluationOffset[] = [
  { x: -2, y: -2 },
  { x: 0, y: -2 },
  { x: 2, y: -2 },
  { x: -2, y: 0 },
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: -2, y: 2 },
  { x: 0, y: 2 },
  { x: 2, y: 2 },
];

export function translateBinaryGlyph(
  glyph: BinaryGlyph,
  offsetX: number,
  offsetY: number,
): BinaryGlyph {
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) {
    throw new Error("位置ずれ量は整数で指定してください。");
  }

  const pixels = new Uint8Array(glyph.pixels.length);
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetX >= glyph.width || targetY < 0 || targetY >= glyph.height) {
        continue;
      }
      pixels[targetY * glyph.width + targetX] = glyph.pixels[y * glyph.width + x];
    }
  }

  return { width: glyph.width, height: glyph.height, pixels };
}

export function evaluateShiftRobustness(
  templates: readonly LoadedGlyphTemplate[],
  offsets: readonly EvaluationOffset[] = DEFAULT_EVALUATION_OFFSETS,
): RecognitionEvaluation {
  if (templates.length === 0 || offsets.length === 0) {
    throw new Error("精度評価には字形と位置ずれ条件が必要です。");
  }

  let correctCharacters = 0;
  let exactSequences = 0;
  let uncertainCharacters = 0;

  for (const offset of offsets) {
    let sequenceIsExact = true;
    for (const template of templates) {
      const binary = translateBinaryGlyph(template.binary, offset.x, offset.y);
      const candidates = rankGlyphCandidates(
        { binary, features: extractBasicFeatures(binary) },
        templates,
        Math.min(2, templates.length),
      );
      const isCorrect = candidates[0]?.templateId === template.definition.id;
      if (isCorrect) correctCharacters += 1;
      else sequenceIsExact = false;

      const topScore = candidates[0]?.score ?? 0;
      const scoreMargin = topScore - (candidates[1]?.score ?? 0);
      if (topScore < 0.65 || scoreMargin < 0.08) uncertainCharacters += 1;
    }
    if (sequenceIsExact) exactSequences += 1;
  }

  const totalCharacters = templates.length * offsets.length;
  return {
    totalCharacters,
    correctCharacters,
    characterAccuracy: correctCharacters / totalCharacters,
    totalSequences: offsets.length,
    exactSequences,
    sequenceExactRate: exactSequences / offsets.length,
    uncertainCharacters,
    uncertainRate: uncertainCharacters / totalCharacters,
  };
}
