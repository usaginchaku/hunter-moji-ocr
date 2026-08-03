import type { BinaryGlyph } from "./features";
import type { KanaModifier } from "../domain/kana-composition";

export interface ModifierAttachment {
  baseSourceId: string;
  markSourceId: string;
  modifier: KanaModifier;
  confidence: number;
  baseBinary: BinaryGlyph;
  markBinary: BinaryGlyph;
}

export interface TextSegment {
  id: string;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  relativeHeight: number;
  baselineAdjusted?: boolean;
  modifierAttachment?: ModifierAttachment;
  binary: BinaryGlyph;
}

export interface TextSegmentation {
  cleaned: BinaryGlyph;
  segments: TextSegment[];
  lineCount: number;
}

export interface SegmentationOptions {
  minComponentArea?: number;
  minLineHeight?: number;
  maxInternalGapRatio?: number;
  maxCandidateAspectRatio?: number;
  splitValleyRatio?: number;
  forcedSplitValleyRatio?: number;
  applyOpening?: boolean;
  lineStrategy?: "all" | "bottom-anchor";
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LineBounds extends Bounds {
  detectedLineIndex: number;
  baselineAdjusted?: boolean;
}

function upperQuartile(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[Math.max(0, middle - 1)] + sorted[middle]) / 2
    : sorted[middle];
}

function assertValidGlyph(glyph: BinaryGlyph): void {
  if (
    !Number.isInteger(glyph.width) ||
    !Number.isInteger(glyph.height) ||
    glyph.width <= 0 ||
    glyph.height <= 0 ||
    glyph.pixels.length !== glyph.width * glyph.height
  ) {
    throw new Error("文字候補を抽出する二値画像のサイズが不正です。");
  }
}

function morphology(source: BinaryGlyph, mode: "erode" | "dilate"): BinaryGlyph {
  const pixels = new Uint8Array(source.pixels.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let value = mode === "erode" ? 1 : 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          const sample =
            sampleX >= 0 && sampleX < source.width && sampleY >= 0 && sampleY < source.height
              ? source.pixels[sampleY * source.width + sampleX]
              : 0;
          if (mode === "erode" && sample === 0) value = 0;
          if (mode === "dilate" && sample !== 0) value = 1;
        }
      }
      pixels[y * source.width + x] = value;
    }
  }
  return { width: source.width, height: source.height, pixels };
}

export function openBinaryGlyph(source: BinaryGlyph): BinaryGlyph {
  assertValidGlyph(source);
  return morphology(morphology(source, "erode"), "dilate");
}

function foregroundCount(source: BinaryGlyph): number {
  let count = 0;
  for (const pixel of source.pixels) if (pixel !== 0) count += 1;
  return count;
}

function removeSmallComponents(source: BinaryGlyph, minArea: number): BinaryGlyph {
  const output = new Uint8Array(source.pixels.length);
  const visited = new Uint8Array(source.pixels.length);
  const queue = new Int32Array(source.pixels.length);

  for (let start = 0; start < source.pixels.length; start += 1) {
    if (source.pixels[start] === 0 || visited[start] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= source.width || nextY < 0 || nextY >= source.height) continue;
          const next = nextY * source.width + nextX;
          if (source.pixels[next] === 0 || visited[next] !== 0) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    if (tail >= minArea) {
      for (let index = 0; index < tail; index += 1) output[queue[index]] = 1;
    }
  }

  return { width: source.width, height: source.height, pixels: output };
}

function projectionRuns(values: readonly number[], minimum: number, maxGap: number): Bounds[] {
  const runs: Bounds[] = [];
  let start = -1;
  let lastInk = -1;
  for (let index = 0; index <= values.length; index += 1) {
    const hasInk = index < values.length && values[index] >= minimum;
    if (hasInk) {
      if (start < 0) start = index;
      lastInk = index;
    } else if (start >= 0 && (index === values.length || index - lastInk > maxGap)) {
      runs.push({ x: start, y: 0, width: lastInk - start + 1, height: 0 });
      start = -1;
      lastInk = -1;
    }
  }
  return runs;
}

function selectBottomAnchoredLine(source: BinaryGlyph, lines: readonly Bounds[]): Bounds[] {
  if (lines.length <= 1) return [...lines];

  const eligible = lines.filter((line) => line.y + line.height >= source.height * 0.45);
  const candidates = eligible.length ? eligible : lines;
  const scored = candidates.map((line) => {
    let occupiedColumns = 0;
    for (let x = 0; x < source.width; x += 1) {
      let occupied = false;
      for (let y = line.y; y < line.y + line.height; y += 1) {
        if (source.pixels[y * source.width + x] !== 0) {
          occupied = true;
          break;
        }
      }
      if (occupied) occupiedColumns += 1;
    }
    const horizontalCoverage = occupiedColumns / source.width;
    const bottomProximity = (line.y + line.height) / source.height;
    const heightShare = Math.min(0.65, line.height / source.height);
    return {
      line,
      score: horizontalCoverage * 0.65 + bottomProximity * 0.25 + heightShare * 0.1,
    };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      right.line.y + right.line.height - (left.line.y + left.line.height),
  );
  return scored[0] ? [scored[0].line] : [];
}

function crop(source: BinaryGlyph, bounds: Bounds): BinaryGlyph {
  const pixels = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      pixels[y * bounds.width + x] = source.pixels[(bounds.y + y) * source.width + bounds.x + x];
    }
  }
  return { width: bounds.width, height: bounds.height, pixels };
}

function tightBounds(source: BinaryGlyph, rough: Bounds): Bounds | null {
  let minX = rough.x + rough.width;
  let minY = rough.y + rough.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = rough.y; y < rough.y + rough.height; y += 1) {
    for (let x = rough.x; x < rough.x + rough.width; x += 1) {
      if (source.pixels[y * source.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function splitWideBounds(
  source: BinaryGlyph,
  bounds: Bounds,
  lineHeight: number,
  maxAspectRatio: number,
  valleyRatio: number,
  forcedValleyRatio: number,
  depth = 0,
): Bounds[] {
  if (depth >= 6 || bounds.width / lineHeight <= maxAspectRatio) return [bounds];

  const projection = Array.from({ length: bounds.width }, () => 0);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      projection[x] += source.pixels[y * source.width + bounds.x + x];
    }
  }

  const minimumPartWidth = Math.max(2, Math.round(lineHeight * 0.32));
  const center = bounds.width / 2;
  let cut = -1;
  let bestInk = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let offset = minimumPartWidth; offset <= bounds.width - minimumPartWidth; offset += 1) {
    const ink = projection[offset];
    const distance = Math.abs(offset - center);
    if (ink < bestInk || (ink === bestInk && distance < bestDistance)) {
      bestInk = ink;
      bestDistance = distance;
      cut = offset;
    }
  }

  const aspectRatio = bounds.width / lineHeight;
  const allowedValleyRatio = aspectRatio >= 1.75 ? forcedValleyRatio : valleyRatio;
  if (cut < 0 || bestInk > Math.max(1, Math.round(lineHeight * allowedValleyRatio)))
    return [bounds];

  const left = tightBounds(source, {
    x: bounds.x,
    y: bounds.y,
    width: cut,
    height: bounds.height,
  });
  const right = tightBounds(source, {
    x: bounds.x + cut,
    y: bounds.y,
    width: bounds.width - cut,
    height: bounds.height,
  });
  if (!left || !right) return [bounds];

  return [
    ...splitWideBounds(
      source,
      left,
      lineHeight,
      maxAspectRatio,
      valleyRatio,
      forcedValleyRatio,
      depth + 1,
    ),
    ...splitWideBounds(
      source,
      right,
      lineHeight,
      maxAspectRatio,
      valleyRatio,
      forcedValleyRatio,
      depth + 1,
    ),
  ];
}

function trimBaselineContamination(
  source: BinaryGlyph,
  candidates: readonly LineBounds[],
  maxAspectRatio: number,
  valleyRatio: number,
  forcedValleyRatio: number,
): LineBounds[] {
  const output: LineBounds[] = [];
  for (const detectedLineIndex of new Set(
    candidates.map((candidate) => candidate.detectedLineIndex),
  )) {
    const lineCandidates = candidates.filter(
      (candidate) => candidate.detectedLineIndex === detectedLineIndex,
    );
    if (lineCandidates.length < 3) {
      output.push(...lineCandidates);
      continue;
    }
    const sortedHeights = lineCandidates.map((candidate) => candidate.height).sort((a, b) => a - b);
    const lowerHalf = sortedHeights.slice(0, Math.max(1, Math.floor(sortedHeights.length / 2)));
    const referenceHeight = median(lowerHalf);
    const contaminated = lineCandidates.filter(
      (candidate) => candidate.height >= referenceHeight * 1.65,
    );
    const cleanCandidates = lineCandidates.filter((candidate) => !contaminated.includes(candidate));
    const cleanWidth = cleanCandidates.reduce((sum, candidate) => sum + candidate.width, 0);
    if (
      contaminated.length === 0 ||
      cleanCandidates.length === 0 ||
      (cleanCandidates.length < 2 && cleanWidth < referenceHeight * 1.4)
    ) {
      output.push(...lineCandidates);
      continue;
    }
    const baseline = median(lineCandidates.map((candidate) => candidate.y + candidate.height));
    const bandTop = Math.max(0, Math.floor(baseline - referenceHeight * 1.1));
    const bandBottom = Math.min(source.height, Math.ceil(baseline + referenceHeight * 0.15));
    const bandHeight = bandBottom - bandTop;
    for (const candidate of lineCandidates) {
      const trimmed = tightBounds(source, {
        x: candidate.x,
        y: bandTop,
        width: candidate.width,
        height: bandHeight,
      });
      if (!trimmed) continue;
      output.push(
        ...splitWideBounds(
          source,
          trimmed,
          bandHeight,
          maxAspectRatio,
          valleyRatio,
          forcedValleyRatio,
        ).map((part) => ({ ...part, detectedLineIndex, baselineAdjusted: true })),
      );
    }
  }
  return output;
}

export function segmentHorizontalText(
  source: BinaryGlyph,
  options: SegmentationOptions = {},
): TextSegmentation {
  assertValidGlyph(source);
  const minArea =
    options.minComponentArea ?? Math.max(6, Math.round(source.width * source.height * 0.00004));
  const minLineHeight = options.minLineHeight ?? Math.max(4, Math.round(source.height * 0.035));
  const gapRatio = options.maxInternalGapRatio ?? 0.18;
  const maxCandidateAspectRatio = options.maxCandidateAspectRatio ?? 1.52;
  const splitValleyRatio = options.splitValleyRatio ?? 0.22;
  const forcedSplitValleyRatio = options.forcedSplitValleyRatio ?? 0.55;
  if (!Number.isInteger(minArea) || minArea <= 0)
    throw new Error("最小連結面積は1以上の整数で指定してください。");
  if (!Number.isInteger(minLineHeight) || minLineHeight <= 0)
    throw new Error("最小行高は1以上の整数で指定してください。");
  if (!Number.isFinite(gapRatio) || gapRatio < 0 || gapRatio >= 1)
    throw new Error("字形内の隙間比率は0以上1未満で指定してください。");

  if (!Number.isFinite(maxCandidateAspectRatio) || maxCandidateAspectRatio <= 1)
    throw new Error("候補の最大縦横比は1より大きい値で指定してください。");
  if (!Number.isFinite(splitValleyRatio) || splitValleyRatio < 0 || splitValleyRatio >= 1)
    throw new Error("分割谷の濃度比率は0以上1未満で指定してください。");
  if (
    !Number.isFinite(forcedSplitValleyRatio) ||
    forcedSplitValleyRatio < splitValleyRatio ||
    forcedSplitValleyRatio >= 1
  )
    throw new Error("強制分割谷の濃度比率は通常の分割谷以上1未満で指定してください。");

  let opened: BinaryGlyph = {
    width: source.width,
    height: source.height,
    pixels: source.pixels.slice(),
  };
  if (options.applyOpening !== false && Math.min(source.width, source.height) >= 320) {
    const openingCandidate = openBinaryGlyph(source);
    const originalForeground = foregroundCount(source);
    const retainedRatio = originalForeground
      ? foregroundCount(openingCandidate) / originalForeground
      : 1;
    if (retainedRatio >= 0.65) opened = openingCandidate;
  }
  const cleaned = removeSmallComponents(opened, minArea);
  const rowProjection = Array.from({ length: cleaned.height }, () => 0);
  for (let y = 0; y < cleaned.height; y += 1) {
    for (let x = 0; x < cleaned.width; x += 1)
      rowProjection[y] += cleaned.pixels[y * cleaned.width + x];
  }
  const detectedRowRuns = projectionRuns(
    rowProjection,
    Math.max(2, Math.round(cleaned.width * 0.002)),
    Math.max(2, Math.round(cleaned.height * 0.012)),
  )
    .map((run) => ({ x: 0, y: run.x, width: cleaned.width, height: run.width }))
    .filter((line) => line.height >= minLineHeight);
  const rowRuns =
    options.lineStrategy === "bottom-anchor"
      ? selectBottomAnchoredLine(cleaned, detectedRowRuns)
      : detectedRowRuns;

  const roughCandidates: LineBounds[] = [];
  for (const [detectedLineIndex, line] of rowRuns.entries()) {
    const columnProjection = Array.from({ length: cleaned.width }, () => 0);
    for (let y = line.y; y < line.y + line.height; y += 1) {
      for (let x = 0; x < cleaned.width; x += 1)
        columnProjection[x] += cleaned.pixels[y * cleaned.width + x];
    }
    const maxGap = Math.max(2, Math.round(line.height * gapRatio));
    for (const run of projectionRuns(columnProjection, 1, maxGap)) {
      const bounds = tightBounds(cleaned, {
        x: run.x,
        y: line.y,
        width: run.width,
        height: line.height,
      });
      if (bounds && bounds.height >= Math.max(3, Math.round(line.height * 0.25))) {
        roughCandidates.push(
          ...splitWideBounds(
            cleaned,
            bounds,
            line.height,
            maxCandidateAspectRatio,
            splitValleyRatio,
            forcedSplitValleyRatio,
          ).map((candidate) => ({ ...candidate, detectedLineIndex })),
        );
      }
    }
  }

  const baselineTrimmedCandidates = trimBaselineContamination(
    cleaned,
    roughCandidates,
    maxCandidateAspectRatio,
    splitValleyRatio,
    forcedSplitValleyRatio,
  );
  const populatedLineIndexes = [
    ...new Set(baselineTrimmedCandidates.map(({ detectedLineIndex }) => detectedLineIndex)),
  ];
  const outputLineIndex = new Map(
    populatedLineIndexes.map((detectedLineIndex, index) => [detectedLineIndex, index]),
  );
  const referenceHeight = new Map<number, number>();
  for (const detectedLineIndex of populatedLineIndexes) {
    referenceHeight.set(
      detectedLineIndex,
      upperQuartile(
        baselineTrimmedCandidates
          .filter((candidate) => candidate.detectedLineIndex === detectedLineIndex)
          .map((candidate) => candidate.height),
      ),
    );
  }
  const segments = [...baselineTrimmedCandidates]
    .sort(
      (left, right) =>
        left.detectedLineIndex - right.detectedLineIndex || left.x - right.x || left.y - right.y,
    )
    .map(({ detectedLineIndex, ...candidate }, index) => ({
      ...candidate,
      id: String(index),
      lineIndex: outputLineIndex.get(detectedLineIndex) ?? 0,
      relativeHeight:
        candidate.height / (referenceHeight.get(detectedLineIndex) ?? candidate.height),
      binary: crop(cleaned, candidate),
    }));

  return { cleaned, segments, lineCount: populatedLineIndexes.length };
}
