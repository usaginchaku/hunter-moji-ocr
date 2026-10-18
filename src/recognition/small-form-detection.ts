import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { TextSegment } from "./segment";

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[Math.max(0, middle - 1)] + sorted[middle]) / 2
    : sorted[middle];
}

export interface SmallFormAssessment {
  isSmall: boolean;
  ambiguous: boolean;
  relativeHeight: number | null;
  baselineDistance: number | null;
}

export function assessSmallFormInLine(
  candidate: Pick<TextSegment, "lineIndex" | "y" | "height">,
  lineSegments: readonly Pick<TextSegment, "lineIndex" | "y" | "height">[],
): SmallFormAssessment {
  const peers = lineSegments.filter((segment) => segment.lineIndex === candidate.lineIndex);
  if (peers.length < 2)
    return { isSmall: false, ambiguous: true, relativeHeight: null, baselineDistance: null };
  const sortedHeights = peers.map((segment) => segment.height).sort((left, right) => left - right);
  const referenceHeight = sortedHeights[Math.max(0, Math.ceil(sortedHeights.length * 0.75) - 1)];
  const baseline = median(peers.map((segment) => segment.y + segment.height));
  const relativeHeight = candidate.height / referenceHeight;
  const baselineDistance = Math.abs(candidate.y + candidate.height - baseline) / referenceHeight;
  const isSmall = relativeHeight <= 0.82 && baselineDistance <= 0.2;
  const ambiguous =
    (Math.abs(relativeHeight - 0.82) <= 0.06 && baselineDistance <= 0.26) ||
    (relativeHeight <= 0.88 && Math.abs(baselineDistance - 0.2) <= 0.06);
  return { isSmall, ambiguous, relativeHeight, baselineDistance };
}

export function detectSmallFormInLine(
  candidate: Pick<TextSegment, "lineIndex" | "y" | "height">,
  lineSegments: readonly Pick<TextSegment, "lineIndex" | "y" | "height">[],
): boolean {
  return assessSmallFormInLine(candidate, lineSegments).isSmall;
}

export interface TemplateSizeObservation {
  id: string;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  template: LoadedGlyphTemplate | undefined;
  score: number;
  margin: number;
  hasModifier: boolean;
  sizeAlternatives?: readonly (LoadedGlyphTemplate | undefined)[];
}

interface CalibratedObservation {
  source: TemplateSizeObservation;
  scale: number;
  bottom: number;
  centerX: number;
}

function calibrateObservation(
  source: TemplateSizeObservation,
  requireMargin = true,
): CalibratedObservation | null {
  const template = source.template;
  const bounds = template?.sourceBounds;
  if (
    !template ||
    !bounds ||
    source.hasModifier ||
    source.score < 0.82 ||
    (requireMargin && source.margin < 0.08)
  )
    return null;
  const heightScale = source.height / bounds.height;
  const widthScale = source.width / bounds.width;
  // A good shape match alone cannot justify resizing a cropped or merged glyph.
  if (Math.min(heightScale, widthScale) / Math.max(heightScale, widthScale) < 0.86) return null;
  return {
    source,
    scale: heightScale * template.definition.height,
    bottom: source.y + heightScale * (template.definition.height - bounds.y),
    centerX: source.x + widthScale * (template.definition.width / 2 - bounds.x),
  };
}

function largestScaleCluster(observations: readonly CalibratedObservation[]): number {
  const largest = Math.max(...observations.map((item) => item.scale));
  return median(
    observations.filter((item) => item.scale >= largest * 0.9).map((item) => item.scale),
  );
}

function linePitch(observations: readonly CalibratedObservation[]): number | null {
  const centers = observations.map((item) => item.centerX).sort((a, b) => a - b);
  const gaps = centers
    .slice(1)
    .map((center, index) => center - centers[index])
    .filter((gap) => gap > 0);
  return gaps.length ? median(gaps) : null;
}

/**
 * Compare inferred drawing sizes, not ink heights: a normal circular い is
 * intrinsically shorter than other full-size glyphs. No generation settings
 * or text are needed; all dimensions come from the recognized image/template.
 */
export function assessTemplateSmallForms(
  observations: readonly TemplateSizeObservation[],
): Map<string, SmallFormAssessment> {
  const calibrated = observations
    .map((source) => calibrateObservation(source))
    .filter((item) => item !== null);
  const lines = new Map<number, CalibratedObservation[]>();
  for (const item of calibrated) {
    const peers = lines.get(item.source.lineIndex) ?? [];
    peers.push(item);
    lines.set(item.source.lineIndex, peers);
  }
  const result = new Map<string, SmallFormAssessment>();
  const lineReferences = new Map<number, { scale: number; bottom: number; count: number }>();
  if (calibrated.length < 2) return result;
  const globalScale = largestScaleCluster(calibrated);
  const globalReferences = calibrated.filter((item) => item.scale >= globalScale * 0.9);
  const referenceLine = [...lines.values()].find(
    (line) => line.filter((item) => globalReferences.includes(item)).length >= 2 && linePitch(line),
  );
  const referencePitch = referenceLine ? linePitch(referenceLine) : null;
  for (const peers of lines.values()) {
    const anchors = peers.filter((item) => !item.source.template?.definition.supportsSmallForm);
    let reference = largestScaleCluster(anchors.length ? anchors : peers);
    const pitch = linePitch(peers);
    // Share a size across a wrapped small-only line only when its observed
    // horizontal cell grid agrees with a line containing normal-sized glyphs.
    const matchesReferenceGrid =
      referenceLine &&
      referencePitch &&
      (pitch !== null
        ? Math.abs(pitch / referencePitch - 1) <= 0.12
        : peers.every((item) => {
            const distance = (item.centerX - referenceLine[0].centerX) / referencePitch;
            return Math.abs(distance - Math.round(distance)) <= 0.12;
          }));
    if (
      anchors.length === 0 &&
      globalReferences.length >= 2 &&
      reference < globalScale * 0.82 &&
      reference >= globalScale * 0.58 &&
      matchesReferenceGrid
    )
      reference = globalScale;
    if (peers.length < 2 && reference === peers[0].scale) continue;
    const baseline = median(peers.map((item) => item.bottom));
    lineReferences.set(peers[0].source.lineIndex, {
      scale: reference,
      bottom: baseline,
      count: peers.length,
    });
    for (const item of peers) {
      const relativeHeight = item.scale / reference;
      const baselineDistance = Math.abs(item.bottom - baseline) / reference;
      if (baselineDistance > 0.14) continue;
      const isSmall = relativeHeight >= 0.5 && relativeHeight <= 0.82;
      result.set(item.source.id, {
        isSmall,
        ambiguous: Math.abs(relativeHeight - 0.82) <= 0.06 || baselineDistance > 0.1,
        relativeHeight,
        baselineDistance,
      });
    }
  }
  // A close base match may still have an unambiguous size. It must agree
  // under every nearby template and must never establish another glyph's reference.
  for (const source of observations) {
    const reference = lineReferences.get(source.lineIndex);
    if (
      source.margin >= 0.08 ||
      !source.sizeAlternatives?.length ||
      !reference ||
      reference.count < 2
    )
      continue;
    const alternatives = [source.template, ...source.sizeAlternatives].map((template) =>
      calibrateObservation({ ...source, template }, false),
    );
    if (alternatives.some((item) => item === null)) continue;
    const plausible = alternatives.filter((item) => item !== null);
    const heights = plausible.map((item) => item.scale / reference.scale);
    const baselineDistances = plausible.map(
      (item) => Math.abs(item.bottom - reference.bottom) / reference.scale,
    );
    if (
      Math.max(...heights) - Math.min(...heights) > 0.1 ||
      heights.some((height) => height < 0.5 || height > 0.82) ||
      baselineDistances.some((distance) => distance > 0.1)
    )
      continue;
    result.set(source.id, {
      isSmall: true,
      ambiguous: true,
      relativeHeight: heights[0],
      baselineDistance: baselineDistances[0],
    });
  }
  return result;
}
