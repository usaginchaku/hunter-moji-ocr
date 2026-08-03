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
