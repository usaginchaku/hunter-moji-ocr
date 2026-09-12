export interface ImagePreprocessing {
  polarity: "dark-text" | "light-text" | "undetermined";
  inverted: boolean;
  contrastAdjusted: boolean;
  /** Otsu split of the input luminance; used for detection, not final binarization. */
  detectionThreshold: number;
  separation: number;
  darkFraction: number;
  borderDarkFraction: number;
  luminanceRange: readonly [number, number];
}

const MINIMUM_CONTRAST = 12;
const MINIMUM_CLASS_FRACTION = 0.003;
const MINIMUM_BACKGROUND_FRACTION = 0.55;
const MINIMUM_BORDER_AGREEMENT = 0.85;
const MINIMUM_SEPARATION = 0.8;
const LOW_CONTRAST_LIMIT = 64;

/** Normalize only confidently detected simple backgrounds. Ordinary inputs retain their bytes. */
export function prepareImageForBinarization(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): { rgba: Uint8ClampedArray; preprocessing: ImagePreprocessing } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length !== width * height * 4
  )
    throw new Error("RGBA画像のサイズと画素数が一致しません。");

  const histogram = new Uint32Array(256);
  const borderHistogram = new Uint32Array(256);
  let borderCount = 0;
  let neutralCount = 0;
  const count = width * height;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] / 255;
    // Match the white canvas used by image loading; transparent RGB must not vote as black.
    const red = rgba[offset] * alpha + 255 * (1 - alpha);
    const green = rgba[offset + 1] * alpha + 255 * (1 - alpha);
    const blue = rgba[offset + 2] * alpha + 255 * (1 - alpha);
    const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    histogram[luminance] += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) <= 16) neutralCount += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      borderHistogram[luminance] += 1;
      borderCount += 1;
    }
  }

  let sum = 0;
  let squaredSum = 0;
  for (let value = 0; value < 256; value += 1) {
    sum += value * histogram[value];
    squaredSum += value * value * histogram[value];
  }
  let darkCount = 0;
  let darkSum = 0;
  let borderDarkCount = 0;
  let bestVariance = 0;
  let low = 0;
  let high = 0;
  let darkFraction = 0;
  let borderDarkFraction = 0;
  let threshold = 0;
  for (let value = 0; value < 255; value += 1) {
    darkCount += histogram[value];
    darkSum += value * histogram[value];
    borderDarkCount += borderHistogram[value];
    if (darkCount === 0 || darkCount === count) continue;
    const darkMean = darkSum / darkCount;
    const lightMean = (sum - darkSum) / (count - darkCount);
    const fraction = darkCount / count;
    const variance = fraction * (1 - fraction) * (lightMean - darkMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      low = darkMean;
      high = lightMean;
      darkFraction = fraction;
      borderDarkFraction = borderDarkCount / borderCount;
      threshold = value;
    }
  }
  const totalVariance = squaredSum / count - (sum / count) ** 2;
  const separation = totalVariance > 0 ? Math.min(1, bestVariance / totalVariance) : 0;
  const contrast = high - low;
  const reliableSplit =
    separation >= MINIMUM_SEPARATION &&
    contrast >= MINIMUM_CONTRAST &&
    Math.min(darkFraction, 1 - darkFraction) >= MINIMUM_CLASS_FRACTION;
  const lightText =
    reliableSplit &&
    darkFraction >= MINIMUM_BACKGROUND_FRACTION &&
    borderDarkFraction >= MINIMUM_BORDER_AGREEMENT;
  const darkText =
    reliableSplit &&
    1 - darkFraction >= MINIMUM_BACKGROUND_FRACTION &&
    1 - borderDarkFraction >= MINIMUM_BORDER_AGREEMENT;
  // Require a clean neutral split to limit amplification of gradients, noise, and color differences.
  const contrastAdjusted =
    (lightText || darkText) &&
    separation >= 0.9 &&
    contrast <= LOW_CONTRAST_LIMIT &&
    neutralCount / count >= 0.95;
  const preprocessing: ImagePreprocessing = {
    polarity: lightText ? "light-text" : darkText ? "dark-text" : "undetermined",
    inverted: lightText,
    contrastAdjusted,
    detectionThreshold: threshold,
    separation,
    darkFraction,
    borderDarkFraction,
    luminanceRange: [low, high],
  };
  if (!lightText && !contrastAdjusted) return { rgba, preprocessing };

  const normalized = new Uint8ClampedArray(rgba.length);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const visible = rgba[offset + channel] * alpha + 255 * (1 - alpha);
      const stretched = contrastAdjusted ? ((visible - low) * 255) / contrast : visible;
      normalized[offset + channel] = lightText ? 255 - stretched : stretched;
    }
    normalized[offset + 3] = 255;
  }
  return { rgba: normalized, preprocessing };
}
