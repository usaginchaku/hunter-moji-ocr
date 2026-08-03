import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import { extractBasicFeatures, type BinaryGlyph } from "./features";
import { associateDetachedHorizontalModifiers } from "./modifier-association";
import { normalizeBinaryGlyph } from "./normalize";
import type { TextSegment } from "./segment";
import { rankGlyphCandidates } from "./similarity";

interface TightSlice {
  binary: BinaryGlyph;
  offsetX: number;
  offsetY: number;
}

function sliceTight(source: BinaryGlyph, startX: number, endX: number): TightSlice | null {
  let minX = endX;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (source.pixels[y * source.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return null;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      pixels[y * width + x] = source.pixels[(minY + y) * source.width + minX + x];
  }
  return { binary: { width, height, pixels }, offsetX: minX, offsetY: minY };
}

function recognitionScore(binary: BinaryGlyph, templates: readonly LoadedGlyphTemplate[]): number {
  const normalized = normalizeBinaryGlyph(binary);
  return (
    rankGlyphCandidates(
      { binary: normalized, features: extractBasicFeatures(normalized) },
      templates,
      1,
    )[0]?.score ?? 0
  );
}

function toSegment(parent: TextSegment, slice: TightSlice, suffix: string): TextSegment {
  return {
    ...parent,
    id: `${parent.id}-${suffix}`,
    x: parent.x + slice.offsetX,
    y: parent.y + slice.offsetY,
    width: slice.binary.width,
    height: slice.binary.height,
    binary: slice.binary,
  };
}

function refinementCuts(source: BinaryGlyph, minimumPartWidth: number): number[] {
  const firstCut = minimumPartWidth;
  const lastCut = source.width - minimumPartWidth;
  const cutCount = lastCut - firstCut + 1;
  if (cutCount <= 96)
    return Array.from({ length: Math.max(0, cutCount) }, (_, index) => firstCut + index);

  const columnInk = new Uint32Array(source.width);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.pixels[y * source.width + x] !== 0) columnInk[x] += 1;
    }
  }

  const selected = new Set<number>();
  const valleyCuts = Array.from({ length: cutCount }, (_, index) => firstCut + index)
    .sort(
      (left, right) =>
        columnInk[left - 1] + columnInk[left] - (columnInk[right - 1] + columnInk[right]) ||
        left - right,
    )
    .slice(0, 80);
  valleyCuts.forEach((cut) => selected.add(cut));
  for (let index = 0; index < 16; index += 1) {
    selected.add(firstCut + Math.round(((lastCut - firstCut) * index) / 15));
  }
  return [...selected].sort((left, right) => left - right);
}

function combineAdjacent(left: TextSegment, right: TextSegment): TextSegment {
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

function mergeLongVowelFragments(
  segments: readonly TextSegment[],
  templates: readonly LoadedGlyphTemplate[],
): TextSegment[] {
  const output: TextSegment[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const left = segments[index];
    const right = segments[index + 1];
    if (!right || left.lineIndex !== right.lineIndex) {
      output.push(left);
      continue;
    }
    if (left.modifierAttachment || right.modifierAttachment) {
      output.push(left);
      continue;
    }
    const gap = right.x - (left.x + left.width);
    const referenceHeight = Math.max(left.height, right.height);
    const widthBalance = Math.min(left.width, right.width) / Math.max(left.width, right.width);
    if (
      gap > referenceHeight * 0.22 ||
      widthBalance < 0.5 ||
      left.width > referenceHeight * 0.68 ||
      right.width > referenceHeight * 0.68
    ) {
      output.push(left);
      continue;
    }
    const combined = combineAdjacent(left, right);
    const normalized = normalizeBinaryGlyph(combined.binary);
    const longCandidate = rankGlyphCandidates(
      { binary: normalized, features: extractBasicFeatures(normalized) },
      templates,
      3,
    ).find((candidate) => candidate.templateId === "long-vowel");
    const separateScore =
      (recognitionScore(left.binary, templates) + recognitionScore(right.binary, templates)) / 2;
    if (
      longCandidate &&
      longCandidate.score >= 0.42 &&
      longCandidate.score >= separateScore - 0.22
    ) {
      output.push(combined);
      index += 1;
    } else output.push(left);
  }
  return output;
}

function pruneBaselineEdgeFragments(segments: readonly TextSegment[]): TextSegment[] {
  const removed = new Set<TextSegment>();
  for (const lineIndex of new Set(segments.map((segment) => segment.lineIndex))) {
    const line = segments
      .filter((segment) => segment.lineIndex === lineIndex)
      .sort((left, right) => left.x - right.x);
    if (line.length < 5) continue;
    const first = line[0];
    const next = line[1];
    const medianWidth = robustReferenceHeight(line.map((segment) => segment.width));
    const gap = next.x - (first.x + first.width);
    if (
      first.baselineAdjusted &&
      first.x <= 1 &&
      first.width < medianWidth * 0.65 &&
      gap <= Math.max(1, medianWidth * 0.08)
    )
      removed.add(first);
  }
  return segments.filter((segment) => !removed.has(segment));
}

function refineOne(
  segment: TextSegment,
  templates: readonly LoadedGlyphTemplate[],
  depth: number,
): TextSegment[] {
  if (depth >= 4 || segment.width < 8) return [segment];
  const minimumPartWidth = Math.max(3, Math.round(segment.height * 0.24));
  if (segment.width < minimumPartWidth * 2) return [segment];

  const unsplitScore = recognitionScore(segment.binary, templates);
  let best:
    | { left: TightSlice; right: TightSlice; cut: number; score: number; balance: number }
    | undefined;
  for (const cut of refinementCuts(segment.binary, minimumPartWidth)) {
    const left = sliceTight(segment.binary, 0, cut);
    const right = sliceTight(segment.binary, cut, segment.width);
    if (!left || !right) continue;
    const leftScore = recognitionScore(left.binary, templates);
    const rightScore = recognitionScore(right.binary, templates);
    const score = (leftScore + rightScore) / 2;
    const balance =
      Math.min(left.binary.width, right.binary.width) /
      Math.max(left.binary.width, right.binary.width);
    if (
      !best ||
      score > best.score + 0.0001 ||
      (Math.abs(score - best.score) <= 0.0001 && balance > best.balance)
    )
      best = { left, right, cut, score, balance };
  }

  if (!best) return [segment];
  const aspectRatio = segment.width / segment.height;
  const requiredGain = best.balance < 0.62 ? 0.13 : 0.07;
  const clearRecognitionGain = aspectRatio >= 1.3 && best.score >= unsplitScore + requiredGain;
  const implausiblyWide =
    aspectRatio >= 1.75 && best.score >= unsplitScore + Math.max(0.015, requiredGain - 0.06);
  if (!clearRecognitionGain && !implausiblyWide) return [segment];

  return [
    ...refineOne(toSegment(segment, best.left, `${depth}l`), templates, depth + 1),
    ...refineOne(toSegment(segment, best.right, `${depth}r`), templates, depth + 1),
  ];
}

function robustReferenceHeight(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[Math.max(0, middle - 1)] + sorted[middle]) / 2
    : sorted[middle];
}

export function refineTextSegmentsWithTemplates(
  segments: readonly TextSegment[],
  templates: readonly LoadedGlyphTemplate[],
): TextSegment[] {
  if (templates.length === 0) return [...segments];
  const refined = pruneBaselineEdgeFragments(
    mergeLongVowelFragments(
      associateDetachedHorizontalModifiers(
        segments.flatMap((segment) => refineOne(segment, templates, 0)),
      ),
      templates,
    ),
  );
  const references = new Map<number, number>();
  for (const lineIndex of new Set(refined.map((segment) => segment.lineIndex))) {
    references.set(
      lineIndex,
      robustReferenceHeight(
        refined
          .filter((segment) => segment.lineIndex === lineIndex)
          .map((segment) => segment.height),
      ),
    );
  }
  return refined
    .sort((left, right) => left.lineIndex - right.lineIndex || left.x - right.x || left.y - right.y)
    .map((segment, index) => ({
      ...segment,
      id: String(index),
      relativeHeight: segment.height / (references.get(segment.lineIndex) ?? segment.height),
    }));
}
