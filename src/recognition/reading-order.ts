export interface CharacterCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrderedCharacterCandidate extends CharacterCandidate {
  relativeHeight: number;
}

export interface HorizontalTextLine {
  top: number;
  bottom: number;
  medianHeight: number;
  referenceHeight: number;
  candidates: OrderedCharacterCandidate[];
}

export interface HorizontalReadingOrder {
  lines: HorizontalTextLine[];
  candidates: OrderedCharacterCandidate[];
}

export interface ReadingOrderOptions {
  lineCenterTolerance?: number;
}

const DEFAULT_LINE_CENTER_TOLERANCE = 0.55;
export const DEFAULT_SMALL_FORM_THRESHOLD = 0.82;

interface MutableLine {
  candidates: CharacterCandidate[];
  centerY: number;
  medianHeight: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function upperQuartile(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)];
}

function validateCandidate(candidate: CharacterCandidate): void {
  const coordinates = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (coordinates.some((value) => !Number.isFinite(value))) {
    throw new Error(`文字候補 ${candidate.id} の矩形に有限でない値があります。`);
  }
  if (candidate.width <= 0 || candidate.height <= 0) {
    throw new Error(`文字候補 ${candidate.id} の幅と高さは0より大きくしてください。`);
  }
}

function refreshLine(line: MutableLine): void {
  line.centerY = median(line.candidates.map((candidate) => candidate.y + candidate.height / 2));
  line.medianHeight = median(line.candidates.map((candidate) => candidate.height));
}

export function orderHorizontalCandidates(
  candidates: readonly CharacterCandidate[],
  options: ReadingOrderOptions = {},
): HorizontalReadingOrder {
  const tolerance = options.lineCenterTolerance ?? DEFAULT_LINE_CENTER_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error("行の中心許容値は0より大きくしてください。");
  }

  candidates.forEach(validateCandidate);
  const byVerticalCenter = [...candidates].sort((left, right) => {
    const centerDifference = left.y + left.height / 2 - (right.y + right.height / 2);
    return centerDifference || left.x - right.x;
  });
  const mutableLines: MutableLine[] = [];

  for (const candidate of byVerticalCenter) {
    const centerY = candidate.y + candidate.height / 2;
    let bestLine: MutableLine | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of mutableLines) {
      const distance = Math.abs(centerY - line.centerY);
      const allowedDistance = Math.min(candidate.height, line.medianHeight) * tolerance;
      if (distance <= allowedDistance && distance < bestDistance) {
        bestLine = line;
        bestDistance = distance;
      }
    }

    if (bestLine) {
      bestLine.candidates.push(candidate);
      refreshLine(bestLine);
    } else {
      mutableLines.push({ candidates: [candidate], centerY, medianHeight: candidate.height });
    }
  }

  mutableLines.sort((left, right) => left.centerY - right.centerY);
  const lines = mutableLines.map<HorizontalTextLine>((line) => {
    const referenceHeight = upperQuartile(line.candidates.map((candidate) => candidate.height));
    const ordered = [...line.candidates]
      .sort((left, right) => left.x - right.x || left.y - right.y)
      .map((candidate) => ({
        ...candidate,
        relativeHeight: candidate.height / referenceHeight,
      }));
    return {
      top: Math.min(...ordered.map((candidate) => candidate.y)),
      bottom: Math.max(...ordered.map((candidate) => candidate.y + candidate.height)),
      medianHeight: line.medianHeight,
      referenceHeight,
      candidates: ordered,
    };
  });

  return { lines, candidates: lines.flatMap((line) => line.candidates) };
}

export function isSmallFormCandidate(
  candidate: Pick<OrderedCharacterCandidate, "relativeHeight">,
  threshold = DEFAULT_SMALL_FORM_THRESHOLD,
): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    throw new Error("小書き判定のしきい値は0より大きく1未満で指定してください。");
  }
  return candidate.relativeHeight <= threshold;
}
