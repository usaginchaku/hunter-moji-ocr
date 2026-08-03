import type { BinaryGlyph } from "./features";

export interface ForegroundBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertValidGlyph(glyph: BinaryGlyph): void {
  if (
    !Number.isInteger(glyph.width) ||
    !Number.isInteger(glyph.height) ||
    glyph.width <= 0 ||
    glyph.height <= 0 ||
    glyph.pixels.length !== glyph.width * glyph.height
  ) {
    throw new Error("正規化する字形のサイズが不正です。");
  }
}

export function findForegroundBounds(glyph: BinaryGlyph): ForegroundBounds | null {
  assertValidGlyph(glyph);
  let minX = glyph.width;
  let minY = glyph.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      if (glyph.pixels[y * glyph.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function normalizeBinaryGlyph(
  source: BinaryGlyph,
  targetSize = 64,
  padding = 8,
): BinaryGlyph {
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    throw new Error("正規化サイズは1以上の整数で指定してください。");
  }
  if (!Number.isInteger(padding) || padding < 0 || padding * 2 >= targetSize) {
    throw new Error("余白は正規化サイズの半分未満の整数で指定してください。");
  }

  const bounds = findForegroundBounds(source);
  const pixels = new Uint8Array(targetSize * targetSize);
  if (!bounds) return { width: targetSize, height: targetSize, pixels };

  let foregroundInBounds = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (source.pixels[y * source.width + x] !== 0) foregroundInBounds += 1;
    }
  }

  const boundingDensity = foregroundInBounds / (bounds.width * bounds.height);
  const boundsAspectRatio = bounds.width / bounds.height;
  const isDenseCompactMark =
    boundingDensity >= 0.7 && boundsAspectRatio >= 0.67 && boundsAspectRatio <= 1.5;
  const fullAvailableSize = targetSize - padding * 2;
  const availableSize = isDenseCompactMark
    ? Math.max(1, Math.round(fullAvailableSize / 3))
    : fullAvailableSize;
  const scale = Math.min(availableSize / bounds.width, availableSize / bounds.height);
  const outputWidth = Math.max(1, Math.round(bounds.width * scale));
  const outputHeight = Math.max(1, Math.round(bounds.height * scale));
  const offsetX = Math.floor((targetSize - outputWidth) / 2);
  const offsetY = Math.floor((targetSize - outputHeight) / 2);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = bounds.y + Math.min(bounds.height - 1, Math.floor(y / scale));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = bounds.x + Math.min(bounds.width - 1, Math.floor(x / scale));
      pixels[(offsetY + y) * targetSize + offsetX + x] =
        source.pixels[sourceY * source.width + sourceX];
    }
  }

  return { width: targetSize, height: targetSize, pixels };
}
