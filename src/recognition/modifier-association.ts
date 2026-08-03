import type { KanaModifier } from "../domain/kana-composition";
import type { BinaryGlyph } from "./features";
import { detectHorizontalModifier } from "./modifier-detection";
import type { ModifierAttachment, TextSegment } from "./segment";

interface AssociationCandidate {
  baseIndex: number;
  markIndex: number;
  modifier: KanaModifier;
  confidence: number;
  score: number;
  combined: BinaryGlyph;
}

function combineSegments(left: TextSegment, right: TextSegment): TextSegment {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  const width = rightEdge - x;
  const height = bottom - y;
  const pixels = new Uint8Array(width * height);
  for (const segment of [left, right]) {
    const offsetX = segment.x - x;
    const offsetY = segment.y - y;
    for (let sourceY = 0; sourceY < segment.height; sourceY += 1) {
      for (let sourceX = 0; sourceX < segment.width; sourceX += 1) {
        if (segment.binary.pixels[sourceY * segment.width + sourceX] !== 0)
          pixels[(offsetY + sourceY) * width + offsetX + sourceX] = 1;
      }
    }
  }
  return {
    ...left,
    id: `${left.id}+${right.id}`,
    x,
    y,
    width,
    height,
    binary: { width, height, pixels },
  };
}

function candidateFor(
  base: TextSegment,
  mark: TextSegment,
  baseIndex: number,
  markIndex: number,
): AssociationCandidate | null {
  if (base.lineIndex !== mark.lineIndex || mark.x <= base.x) return null;
  const gap = mark.x - (base.x + base.width);
  const heightRatio = mark.height / base.height;
  const widthRatio = mark.width / base.width;
  const centerY = mark.y + mark.height / 2;
  const verticalRatio = (centerY - base.y) / base.height;
  const plausibleGeometry =
    gap >= -Math.max(1, base.width * 0.08) &&
    gap <= base.height * 0.72 &&
    heightRatio >= 0.14 &&
    heightRatio <= 0.62 &&
    widthRatio <= 0.68 &&
    verticalRatio >= 0.48 &&
    verticalRatio <= 1.28;
  if (!plausibleGeometry) return null;

  const combined = combineSegments(base, mark);
  const detection = detectHorizontalModifier(combined.binary);
  if (!detection.modifier || detection.confidence < 0.55) return null;
  const normalizedGap = Math.max(0, gap) / Math.max(1, base.height);
  const expectedVertical = 0.78;
  const geometryPenalty = normalizedGap * 0.18 + Math.abs(verticalRatio - expectedVertical) * 0.08;
  return {
    baseIndex,
    markIndex,
    modifier: detection.modifier,
    confidence: detection.confidence,
    score: detection.confidence - geometryPenalty,
    combined: combined.binary,
  };
}

function attach(
  base: TextSegment,
  mark: TextSegment,
  candidate: AssociationCandidate,
): TextSegment {
  const combined = combineSegments(base, mark);
  const modifierAttachment: ModifierAttachment = {
    baseSourceId: base.id,
    markSourceId: mark.id,
    modifier: candidate.modifier,
    confidence: candidate.confidence,
    baseBinary: base.binary,
    markBinary: mark.binary,
  };
  return { ...combined, binary: candidate.combined, modifierAttachment };
}

export function associateDetachedHorizontalModifiers(
  segments: readonly TextSegment[],
): TextSegment[] {
  const candidates: AssociationCandidate[] = [];
  for (let baseIndex = 0; baseIndex < segments.length; baseIndex += 1) {
    for (let markIndex = 0; markIndex < segments.length; markIndex += 1) {
      if (baseIndex === markIndex) continue;
      const candidate = candidateFor(
        segments[baseIndex],
        segments[markIndex],
        baseIndex,
        markIndex,
      );
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.baseIndex - right.baseIndex ||
      left.markIndex - right.markIndex,
  );

  const usedBases = new Set<number>();
  const usedMarks = new Set<number>();
  const attachments = new Map<number, AssociationCandidate>();
  for (const candidate of candidates) {
    if (
      usedBases.has(candidate.baseIndex) ||
      usedMarks.has(candidate.markIndex) ||
      usedMarks.has(candidate.baseIndex) ||
      usedBases.has(candidate.markIndex)
    )
      continue;
    usedBases.add(candidate.baseIndex);
    usedMarks.add(candidate.markIndex);
    attachments.set(candidate.baseIndex, candidate);
  }

  return segments.flatMap((segment, index) => {
    if (usedMarks.has(index)) return [];
    const candidate = attachments.get(index);
    return candidate ? [attach(segment, segments[candidate.markIndex], candidate)] : [segment];
  });
}
