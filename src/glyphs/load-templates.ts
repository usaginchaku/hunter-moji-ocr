import { resolvePublicAsset } from "./assets";
import type { GlyphTemplateDefinition } from "./types";
import {
  extractBasicFeatures,
  type BasicGlyphFeatures,
  type BinaryGlyph,
} from "../recognition/features";
import { normalizeBinaryGlyph } from "../recognition/normalize";

export interface LoadedGlyphTemplate {
  definition: GlyphTemplateDefinition;
  binary: BinaryGlyph;
  features: BasicGlyphFeatures;
}

const FOREGROUND_DARKNESS_THRESHOLD = 64;

export function rgbaToBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA画像のサイズと画素数が一致しません。");
  }

  const pixels = new Uint8Array(width * height);

  for (let index = 0; index < pixels.length; index += 1) {
    const rgbaIndex = index * 4;
    const red = rgba[rgbaIndex];
    const green = rgba[rgbaIndex + 1];
    const blue = rgba[rgbaIndex + 2];
    const alpha = rgba[rgbaIndex + 3] / 255;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const darkness = (255 - luminance) * alpha;
    pixels[index] = darkness >= FOREGROUND_DARKNESS_THRESHOLD ? 1 : 0;
  }

  return { width, height, pixels };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`字形SVGを読み込めませんでした: ${source}`)),
      { once: true },
    );
    image.src = source;
  });
}

export async function loadGlyphTemplate(
  definition: GlyphTemplateDefinition,
): Promise<LoadedGlyphTemplate> {
  const image = await loadImage(resolvePublicAsset(definition.templatePath));
  const canvas = document.createElement("canvas");
  canvas.width = definition.width;
  canvas.height = definition.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2Dを初期化できませんでした。");

  context.clearRect(0, 0, definition.width, definition.height);
  context.drawImage(image, 0, 0, definition.width, definition.height);
  const imageData = context.getImageData(0, 0, definition.width, definition.height);
  const binary = normalizeBinaryGlyph(
    rgbaToBinaryGlyph(imageData.data, definition.width, definition.height),
    definition.width,
  );

  return {
    definition,
    binary,
    features: extractBasicFeatures(binary),
  };
}
