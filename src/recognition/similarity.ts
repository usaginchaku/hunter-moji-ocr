import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { BasicGlyphFeatures, BinaryGlyph } from "./features";

export interface RecognitionInput {
  binary: BinaryGlyph;
  features: BasicGlyphFeatures;
}

export interface ScoreBreakdown {
  bitmap: number;
  projection: number;
  aspectRatio: number;
  foreground: number;
  components: number;
  spatial: number;
}

export interface GlyphCandidate {
  templateId: string;
  kana: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bitmapSimilarityAtOffset(
  firstForeground: readonly number[],
  second: BinaryGlyph,
  firstForegroundCount: number,
  secondForegroundCount: number,
  offsetX: number,
  offsetY: number,
): number {
  let intersection = 0;
  for (const index of firstForeground) {
    const x = index % second.width;
    const y = Math.floor(index / second.width);
    const shiftedX = x - offsetX;
    const shiftedY = y - offsetY;
    if (
      shiftedX >= 0 &&
      shiftedX < second.width &&
      shiftedY >= 0 &&
      shiftedY < second.height &&
      second.pixels[shiftedY * second.width + shiftedX] !== 0
    )
      intersection += 1;
  }
  const union = firstForegroundCount + secondForegroundCount - intersection;
  return union === 0 ? 1 : intersection / union;
}

function bitmapSimilarity(first: BinaryGlyph, second: BinaryGlyph): number {
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error("比較する字形のサイズが一致しません。");
  }
  const firstForeground: number[] = [];
  let secondForegroundCount = 0;
  for (let index = 0; index < first.pixels.length; index += 1) {
    if (first.pixels[index] !== 0) firstForeground.push(index);
    if (second.pixels[index] !== 0) secondForegroundCount += 1;
  }
  let best = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1)
      best = Math.max(
        best,
        bitmapSimilarityAtOffset(
          firstForeground,
          second,
          firstForeground.length,
          secondForegroundCount,
          offsetX,
          offsetY,
        ),
      );
  }
  return best;
}

function projectionSimilarity(first: number[], second: number[]): number {
  if (first.length !== second.length) {
    throw new Error("比較する射影の長さが一致しません。");
  }
  if (first.length === 0) return 1;

  const totalDifference = first.reduce(
    (sum, value, index) => sum + Math.abs(value - second[index]),
    0,
  );
  return clamp01(1 - totalDifference / first.length);
}

function ratioSimilarity(first: number, second: number): number {
  if (first === 0 && second === 0) return 1;
  if (first <= 0 || second <= 0) return 0;
  return Math.min(first, second) / Math.max(first, second);
}

export function scoreGlyph(input: RecognitionInput, template: LoadedGlyphTemplate): GlyphCandidate {
  const projectionX = projectionSimilarity(
    input.features.projectionX,
    template.features.projectionX,
  );
  const projectionY = projectionSimilarity(
    input.features.projectionY,
    template.features.projectionY,
  );

  const scoreBreakdown: ScoreBreakdown = {
    bitmap: bitmapSimilarity(input.binary, template.binary),
    projection: (projectionX + projectionY) / 2,
    aspectRatio: ratioSimilarity(input.features.aspectRatio, template.features.aspectRatio),
    foreground: clamp01(
      1 - Math.abs(input.features.foregroundRatio - template.features.foregroundRatio),
    ),
    components: clamp01(
      1 - Math.abs(input.features.componentCount - template.features.componentCount) / 3,
    ),
    spatial: projectionSimilarity(input.features.spatialGrid, template.features.spatialGrid),
  };

  const componentWeight = input.features.componentCount === 2 ? 0.1 : 0;
  const spatialWeight = input.features.componentCount === 1 ? 0.15 : 0;
  const foregroundWeight = input.features.componentCount === 1 ? 0.15 : 0.1;
  const bitmapWeight = 0.65 - componentWeight - spatialWeight - foregroundWeight;
  const weightedScore =
    scoreBreakdown.bitmap * bitmapWeight +
    scoreBreakdown.projection * 0.25 +
    scoreBreakdown.aspectRatio * 0.1 +
    scoreBreakdown.foreground * foregroundWeight +
    scoreBreakdown.components * componentWeight +
    scoreBreakdown.spatial * spatialWeight;
  const score = weightedScore > 1 - Number.EPSILON ? 1 : clamp01(weightedScore);

  return {
    templateId: template.definition.id,
    kana: template.definition.kana,
    score,
    scoreBreakdown,
  };
}

export function rankGlyphCandidates(
  input: RecognitionInput,
  templates: readonly LoadedGlyphTemplate[],
  limit = 3,
): GlyphCandidate[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("候補数は1以上の整数で指定してください。");
  }

  return templates
    .map((template) => scoreGlyph(input, template))
    .sort(
      (first, second) =>
        second.score - first.score || first.templateId.localeCompare(second.templateId),
    )
    .slice(0, limit);
}
