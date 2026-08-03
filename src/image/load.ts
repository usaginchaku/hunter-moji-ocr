import type { BinaryGlyph } from "../recognition/features";
import { validateImageDimensions } from "../app/file-validation";

export const MAX_PROCESSING_SIDE = 2048;

export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BinarizationMode =
  "background" | "dark-ink" | "local-contrast" | "local-color" | "sauvola" | "neutral-ink";

export interface BinaryGlyphVariant {
  mode: BinarizationMode;
  label: string;
  binary: BinaryGlyph;
}

export function calculateProcessingSize(
  sourceWidth: number,
  sourceHeight: number,
  maximumSide = MAX_PROCESSING_SIDE,
): { width: number; height: number; scale: number } {
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    !Number.isInteger(maximumSide) ||
    maximumSide <= 0
  )
    throw new Error("処理対象画像のサイズが不正です。");
  const scale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export function resolveCropBounds(
  imageWidth: number,
  imageHeight: number,
  crop?: NormalizedCrop | null,
): PixelCrop {
  if (
    !Number.isInteger(imageWidth) ||
    !Number.isInteger(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new Error("切り抜く画像のサイズが不正です。");
  }
  if (!crop) return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001
  ) {
    throw new Error("切り抜き範囲は画像内の0から1で指定してください。");
  }

  const x = Math.min(imageWidth - 1, Math.floor(crop.x * imageWidth));
  const y = Math.min(imageHeight - 1, Math.floor(crop.y * imageHeight));
  const right = Math.max(
    x + 1,
    Math.min(imageWidth, Math.ceil((crop.x + crop.width) * imageWidth)),
  );
  const bottom = Math.max(
    y + 1,
    Math.min(imageHeight, Math.ceil((crop.y + crop.height) * imageHeight)),
  );
  return { x, y, width: right - x, height: bottom - y };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function rgbaToAdaptiveBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new Error("RGBA画像のサイズと画素数が一致しません。");
  }

  const redSamples: number[] = [];
  const greenSamples: number[] = [];
  const blueSamples: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  const sample = (x: number, y: number): void => {
    const index = (y * width + x) * 4;
    redSamples.push(rgba[index]);
    greenSamples.push(rgba[index + 1]);
    blueSamples.push(rgba[index + 2]);
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }

  const background = {
    red: median(redSamples),
    green: median(greenSamples),
    blue: median(blueSamples),
  };
  const backgroundLuminance =
    background.red * 0.2126 + background.green * 0.7152 + background.blue * 0.0722;
  const pixels = new Uint8Array(width * height);

  for (let index = 0; index < pixels.length; index += 1) {
    const rgbaIndex = index * 4;
    const red = rgba[rgbaIndex];
    const green = rgba[rgbaIndex + 1];
    const blue = rgba[rgbaIndex + 2];
    const alpha = rgba[rgbaIndex + 3] / 255;
    const colorDistance = Math.hypot(
      red - background.red,
      green - background.green,
      blue - background.blue,
    );
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const differsFromBackground = colorDistance * alpha >= 70;
    const looksLikeInk =
      backgroundLuminance - luminance >= 38 || luminance <= Math.min(110, backgroundLuminance - 24);
    pixels[index] = differsFromBackground && looksLikeInk ? 1 : 0;
  }

  return { width, height, pixels };
}

function luminanceAt(rgba: Uint8ClampedArray, index: number): number {
  const rgbaIndex = index * 4;
  return rgba[rgbaIndex] * 0.2126 + rgba[rgbaIndex + 1] * 0.7152 + rgba[rgbaIndex + 2] * 0.0722;
}

export function rgbaToDarkInkBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4)
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const luminances = Float32Array.from({ length: width * height }, (_, index) =>
    luminanceAt(rgba, index),
  );
  const sorted = luminances.slice().sort();
  const darkPercentile = sorted[Math.floor(sorted.length * 0.28)];
  const threshold = Math.min(138, darkPercentile + 24);
  const pixels = new Uint8Array(width * height);

  for (let index = 0; index < pixels.length; index += 1) {
    const rgbaIndex = index * 4;
    const red = rgba[rgbaIndex];
    const green = rgba[rgbaIndex + 1];
    const blue = rgba[rgbaIndex + 2];
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const alpha = rgba[rgbaIndex + 3] / 255;
    const neutralOrVeryDark = saturation <= 58 || luminances[index] <= 78;
    pixels[index] = alpha >= 0.5 && luminances[index] <= threshold && neutralOrVeryDark ? 1 : 0;
  }

  return { width, height, pixels };
}

export function rgbaToLocalContrastBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4)
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const luminances = Float32Array.from({ length: width * height }, (_, index) =>
    luminanceAt(rgba, index),
  );
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += luminances[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.1));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const area = (right - left) * (bottom - top);
      const localMean =
        (integral[bottom * (width + 1) + right] -
          integral[top * (width + 1) + right] -
          integral[bottom * (width + 1) + left] +
          integral[top * (width + 1) + left]) /
        area;
      const index = y * width + x;
      const rgbaIndex = index * 4;
      const saturation =
        Math.max(rgba[rgbaIndex], rgba[rgbaIndex + 1], rgba[rgbaIndex + 2]) -
        Math.min(rgba[rgbaIndex], rgba[rgbaIndex + 1], rgba[rgbaIndex + 2]);
      const neutralOrVeryDark = saturation <= 66 || luminances[index] <= 82;
      pixels[index] =
        luminances[index] <= 155 && localMean - luminances[index] >= 23 && neutralOrVeryDark
          ? 1
          : 0;
    }
  }

  return { width, height, pixels };
}

export function rgbaToLocalColorContrastBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4)
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const integralWidth = width + 1;
  const redIntegral = new Uint32Array(integralWidth * (height + 1));
  const greenIntegral = new Uint32Array(redIntegral.length);
  const blueIntegral = new Uint32Array(redIntegral.length);
  for (let y = 0; y < height; y += 1) {
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    for (let x = 0; x < width; x += 1) {
      const rgbaIndex = (y * width + x) * 4;
      redSum += rgba[rgbaIndex];
      greenSum += rgba[rgbaIndex + 1];
      blueSum += rgba[rgbaIndex + 2];
      const integralIndex = (y + 1) * integralWidth + x + 1;
      redIntegral[integralIndex] = redIntegral[y * integralWidth + x + 1] + redSum;
      greenIntegral[integralIndex] = greenIntegral[y * integralWidth + x + 1] + greenSum;
      blueIntegral[integralIndex] = blueIntegral[y * integralWidth + x + 1] + blueSum;
    }
  }
  const rectangleSum = (
    values: Uint32Array,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): number =>
    values[bottom * integralWidth + right] -
    values[top * integralWidth + right] -
    values[bottom * integralWidth + left] +
    values[top * integralWidth + left];

  const radius = Math.max(3, Math.min(28, Math.round(Math.min(width, height) * 0.12)));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const area = (right - left) * (bottom - top);
      const meanRed = rectangleSum(redIntegral, left, top, right, bottom) / area;
      const meanGreen = rectangleSum(greenIntegral, left, top, right, bottom) / area;
      const meanBlue = rectangleSum(blueIntegral, left, top, right, bottom) / area;
      const index = y * width + x;
      const rgbaIndex = index * 4;
      const red = rgba[rgbaIndex];
      const green = rgba[rgbaIndex + 1];
      const blue = rgba[rgbaIndex + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const localLuminance = meanRed * 0.2126 + meanGreen * 0.7152 + meanBlue * 0.0722;
      const localColorDistance = Math.hypot(meanRed - red, meanGreen - green, meanBlue - blue);
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
      pixels[index] =
        rgba[rgbaIndex + 3] >= 128 &&
        localLuminance - luminance >= 16 &&
        localColorDistance >= 34 &&
        (saturation <= 72 || luminance <= 86)
          ? 1
          : 0;
    }
  }
  return { width, height, pixels };
}

export function rgbaToSauvolaBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4)
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const luminances = Float32Array.from({ length: width * height }, (_, index) =>
    luminanceAt(rgba, index),
  );
  const integralWidth = width + 1;
  const integral = new Uint32Array(integralWidth * (height + 1));
  const squaredIntegral = new Float64Array(integral.length);
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let squaredRowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const luminance = luminances[y * width + x];
      rowSum += luminance;
      squaredRowSum += luminance * luminance;
      const integralIndex = (y + 1) * integralWidth + x + 1;
      integral[integralIndex] = integral[y * integralWidth + x + 1] + rowSum;
      squaredIntegral[integralIndex] = squaredIntegral[y * integralWidth + x + 1] + squaredRowSum;
    }
  }

  const radius = Math.max(3, Math.min(32, Math.round(Math.min(width, height) * 0.12)));
  const pixels = new Uint8Array(width * height);
  const rectangleSum = (
    values: Float64Array | Uint32Array,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): number =>
    values[bottom * integralWidth + right] -
    values[top * integralWidth + right] -
    values[bottom * integralWidth + left] +
    values[top * integralWidth + left];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const area = (right - left) * (bottom - top);
      const mean = rectangleSum(integral, left, top, right, bottom) / area;
      const meanSquare = rectangleSum(squaredIntegral, left, top, right, bottom) / area;
      const deviation = Math.sqrt(Math.max(0, meanSquare - mean * mean));
      const threshold = mean * (1 + 0.28 * (deviation / 128 - 1));
      const index = y * width + x;
      const rgbaIndex = index * 4;
      const saturation =
        Math.max(rgba[rgbaIndex], rgba[rgbaIndex + 1], rgba[rgbaIndex + 2]) -
        Math.min(rgba[rgbaIndex], rgba[rgbaIndex + 1], rgba[rgbaIndex + 2]);
      pixels[index] =
        rgba[rgbaIndex + 3] >= 128 &&
        luminances[index] <= threshold &&
        luminances[index] <= 175 &&
        saturation <= 52
          ? 1
          : 0;
    }
  }
  return { width, height, pixels };
}

export function rgbaToNeutralInkBinaryGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyph {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4)
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const luminances = Float32Array.from({ length: width * height }, (_, index) =>
    luminanceAt(rgba, index),
  );
  const integralWidth = width + 1;
  const integral = new Uint32Array(integralWidth * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += luminances[y * width + x];
      integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + rowSum;
    }
  }
  const radius = Math.max(3, Math.min(24, Math.round(Math.min(width, height) * 0.1)));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const area = (right - left) * (bottom - top);
      const localMean =
        (integral[bottom * integralWidth + right] -
          integral[top * integralWidth + right] -
          integral[bottom * integralWidth + left] +
          integral[top * integralWidth + left]) /
        area;
      const index = y * width + x;
      const rgbaIndex = index * 4;
      const red = rgba[rgbaIndex];
      const green = rgba[rgbaIndex + 1];
      const blue = rgba[rgbaIndex + 2];
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
      pixels[index] =
        rgba[rgbaIndex + 3] >= 128 &&
        luminances[index] <= 135 &&
        saturation <= 38 &&
        localMean - luminances[index] >= 14
          ? 1
          : 0;
    }
  }
  return { width, height, pixels };
}

function isImageBitmap(image: ImageBitmap | HTMLImageElement): image is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older browsers can reject createImageBitmap for otherwise valid files.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageRgba(
  file: File,
  crop?: NormalizedCrop | null,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const image = await decodeImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    if (isImageBitmap(image)) image.close();
    throw new Error("画像の縦横サイズを取得できませんでした。");
  }
  const dimensionValidation = validateImageDimensions(sourceWidth, sourceHeight);
  if (!dimensionValidation.ok) {
    if (isImageBitmap(image)) image.close();
    throw new Error(dimensionValidation.message);
  }

  const cropBounds = resolveCropBounds(sourceWidth, sourceHeight, crop);
  const { width, height } = calculateProcessingSize(cropBounds.width, cropBounds.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  try {
    if (!context) throw new Error("Canvas 2Dを初期化できませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(
      image,
      cropBounds.x,
      cropBounds.y,
      cropBounds.width,
      cropBounds.height,
      0,
      0,
      width,
      height,
    );
    const imageData = context.getImageData(0, 0, width, height);
    return { rgba: imageData.data, width, height };
  } finally {
    if (isImageBitmap(image)) image.close();
  }
}

export async function loadImageAsBinaryGlyph(
  file: File,
  crop?: NormalizedCrop | null,
): Promise<BinaryGlyph> {
  const image = await loadImageRgba(file, crop);
  return rgbaToAdaptiveBinaryGlyph(image.rgba, image.width, image.height);
}

export async function loadImageAsBinaryGlyphVariants(
  file: File,
  crop?: NormalizedCrop | null,
): Promise<BinaryGlyphVariant[]> {
  const image = await loadImageRgba(file, crop);
  const variants: BinaryGlyphVariant[] = [];
  const append = async (variant: BinaryGlyphVariant): Promise<void> => {
    variants.push(variant);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  };
  await append({
    mode: "background",
    label: "背景色との差",
    binary: rgbaToAdaptiveBinaryGlyph(image.rgba, image.width, image.height),
  });
  await append({
    mode: "dark-ink",
    label: "黒い線を優先",
    binary: rgbaToDarkInkBinaryGlyph(image.rgba, image.width, image.height),
  });
  await append({
    mode: "local-contrast",
    label: "局所コントラスト",
    binary: rgbaToLocalContrastBinaryGlyph(image.rgba, image.width, image.height),
  });
  await append({
    mode: "local-color",
    label: "局所色差",
    binary: rgbaToLocalColorContrastBinaryGlyph(image.rgba, image.width, image.height),
  });
  await append({
    mode: "sauvola",
    label: "局所分散（Sauvola）",
    binary: rgbaToSauvolaBinaryGlyph(image.rgba, image.width, image.height),
  });
  await append({
    mode: "neutral-ink",
    label: "無彩色の黒線",
    binary: rgbaToNeutralInkBinaryGlyph(image.rgba, image.width, image.height),
  });
  return variants;
}
