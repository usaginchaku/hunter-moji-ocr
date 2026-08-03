import type { BinaryGlyph } from "./features";
import { findForegroundBounds } from "./normalize";

export const DEFAULT_SMALL_GLYPH_SCALE = 0.7;

export function createSmallBinaryGlyph(
  source: BinaryGlyph,
  scale = DEFAULT_SMALL_GLYPH_SCALE,
): BinaryGlyph {
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) {
    throw new Error("小書き字形の倍率は0より大きく1未満で指定してください。");
  }

  const bounds = findForegroundBounds(source);
  const pixels = new Uint8Array(source.width * source.height);
  if (!bounds) return { width: source.width, height: source.height, pixels };

  const outputWidth = Math.max(1, Math.round(bounds.width * scale));
  const outputHeight = Math.max(1, Math.round(bounds.height * scale));
  const offsetX = Math.floor((source.width - outputWidth) / 2);
  const offsetY = Math.floor((source.height - outputHeight) / 2);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY =
      bounds.y + Math.min(bounds.height - 1, Math.floor((y / outputHeight) * bounds.height));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX =
        bounds.x + Math.min(bounds.width - 1, Math.floor((x / outputWidth) * bounds.width));
      pixels[(offsetY + y) * source.width + offsetX + x] =
        source.pixels[sourceY * source.width + sourceX];
    }
  }

  return { width: source.width, height: source.height, pixels };
}
