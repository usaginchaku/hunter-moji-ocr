import { describe, expect, it, vi, afterEach } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import { prepareImageForBinarization } from "../src/image/preprocess";
import { loadImageAsBinaryGlyph, loadImageAsBinaryGlyphVariants } from "../src/image/load";
import { extractBasicFeatures, type BinaryGlyph } from "../src/recognition/features";
import { normalizeBinaryGlyph } from "../src/recognition/normalize";
import { runRecognitionPipeline } from "../src/recognition/recognition-pipeline";
import {
  PUBLIC_EVALUATION_CASES,
  PUBLIC_EVALUATION_GLYPHS,
} from "./fixtures/public-evaluation-set";
import {
  PREPROCESSING_PATTERNS,
  originalBinarizationVariants,
} from "./fixtures/preprocessing-patterns";

function render(image: BinaryGlyph, background: string, ink: string) {
  const colors = [background, ink].map((hex) =>
    [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)),
  );
  const width = image.width * 3;
  const height = image.height * 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const foreground = image.pixels[Math.floor(y / 3) * image.width + Math.floor(x / 3)];
      rgba.set([...colors[foreground], 255], (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
}

function prepare(image: ReturnType<typeof render>) {
  return prepareImageForBinarization(image.rgba, image.width, image.height);
}

const templates: LoadedGlyphTemplate[] = PUBLIC_EVALUATION_GLYPHS.map((glyph) => {
  const binary = normalizeBinaryGlyph(glyph.binary);
  return {
    definition: {
      id: glyph.id,
      kana: glyph.kana,
      direction: "horizontal" as const,
      templatePath: `self-made://${glyph.id}`,
      width: 64,
      height: 64,
      status: "ready" as const,
      supportsDakuten: false,
      supportsHandakuten: false,
      supportsSmallForm: false,
    },
    binary,
    features: extractBasicFeatures(binary),
  };
});

describe("polarity and contrast preprocessing", () => {
  it.each(PREPROCESSING_PATTERNS)(
    "$id retains foreground and the original auto OCR result",
    (pattern) => {
      for (const testCase of PUBLIC_EVALUATION_CASES) {
        const image = render(testCase.image, pattern.background, pattern.ink);
        const original = image.rgba.slice();
        const prepared = prepare(image);
        const variants = originalBinarizationVariants(prepared.rgba, image.width, image.height);
        const reference = render(testCase.image, "#ffffff", "#000000");
        expect(variants[0].binary).toEqual(
          originalBinarizationVariants(reference.rgba, image.width, image.height)[0].binary,
        );
        const baseline = runRecognitionPipeline(
          originalBinarizationVariants(reference.rgba, image.width, image.height),
          templates,
          "auto",
        ).selected;
        const automatic = runRecognitionPipeline(variants, templates, "auto").selected;
        expect(
          automatic?.recognized.map((glyph) => [glyph.lineIndex, glyph.automaticBaseKana]),
        ).toEqual(baseline?.recognized.map((glyph) => [glyph.lineIndex, glyph.automaticBaseKana]));
        // The existing auto selector can discard an upper line; verify complete extraction
        // independently through the unchanged background mode, without hiding that limitation.
        const selected = runRecognitionPipeline(variants, templates, "background").selected;
        const lines = new Map<number, string[]>();
        for (const glyph of selected?.recognized ?? []) {
          const line = lines.get(glyph.lineIndex) ?? [];
          line.push(glyph.automaticBaseKana);
          lines.set(glyph.lineIndex, line);
        }
        expect([...lines.values()].map((line) => line.join("")).join("\n")).toBe(testCase.expected);
        expect(image.rgba).toEqual(original);
      }
    },
  );

  it.each(["white-black", "gray-black", "pale-orange"])(
    "%s passes the identical input to all six original branches",
    (id) => {
      const pattern = PREPROCESSING_PATTERNS.find((item) => item.id === id)!;
      const image = render(PUBLIC_EVALUATION_CASES[0].image, pattern.background, pattern.ink);
      expect(prepare(image).rgba).toBe(image.rgba);
    },
  );

  it("reproduces the original dark-background failure before normalization", () => {
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#000000", "#ffffff");
    const variants = originalBinarizationVariants(image.rgba, image.width, image.height);
    expect(variants[0].binary.pixels.every((value) => value === 0)).toBe(true);
    expect(
      variants[1].binary.pixels.reduce((sum, value) => sum + value, 0) /
        (image.width * image.height),
    ).toBeGreaterThan(0.8);
    expect(prepare(image).preprocessing).toMatchObject({
      polarity: "light-text",
      inverted: true,
      contrastAdjusted: false,
    });
  });

  it.each([0, 64, 128, 255])("does not stretch or invert a uniform image at %i", (value) => {
    const hex = `#${value.toString(16).padStart(2, "0").repeat(3)}`;
    const image = render(PUBLIC_EVALUATION_CASES[0].image, hex, hex);
    expect(prepare(image).rgba).toBe(image.rgba);
    expect(prepare(image).preprocessing.polarity).toBe("undetermined");
  });

  it("does not amplify tiny contrast, a smooth gradient or a colored low-contrast image", () => {
    for (const [background, ink] of [
      ["#444444", "#494949"],
      ["#bbaabb", "#a392a3"],
    ]) {
      const image = render(PUBLIC_EVALUATION_CASES[0].image, background, ink);
      expect(prepare(image).rgba).toBe(image.rgba);
    }
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#000000", "#ffffff");
    for (let index = 0; index < image.width * image.height; index += 1) {
      const value = 80 + Math.floor(((index % image.width) * 60) / image.width);
      image.rgba.set([value, value, value, 255], index * 4);
    }
    expect(prepare(image).rgba).toBe(image.rgba);
  });

  it("does not mistake a dark frame on white paper for a dark background", () => {
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#ffffff", "#000000");
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1)
          image.rgba.set([0, 0, 0, 255], (y * image.width + x) * 4);
      }
    }
    expect(prepare(image).rgba).toBe(image.rgba);
  });

  it("does not vote transparent black pixels as a dark background", () => {
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#000000", "#ffffff");
    for (let index = 0; index < image.rgba.length; index += 4) {
      if (image.rgba[index] === 0) image.rgba[index + 3] = 0;
    }
    expect(prepare(image).preprocessing).toMatchObject({
      inverted: false,
      contrastAdjusted: false,
    });
  });

  it("preserves anti-aliased strokes under paired inversion", () => {
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#ffffff", "#000000");
    for (let index = 0; index < image.rgba.length; index += 4) {
      if (image.rgba[index] === 0 && index % 12 === 0) image.rgba.set([96, 96, 96], index);
    }
    const inverted = image.rgba.map((value, index) => (index % 4 === 3 ? value : 255 - value));
    expect(prepareImageForBinarization(inverted, image.width, image.height).rgba).toEqual(
      image.rgba,
    );
  });

  it.each([
    [0, 1],
    [1.5, 2],
    [-1, 2],
    [NaN, 1],
    [1, Infinity],
    [2, 2],
  ])("rejects invalid dimensions %s x %s", (width, height) => {
    expect(() => prepareImageForBinarization(new Uint8ClampedArray(4), width, height)).toThrow(
      "RGBA画像",
    );
  });
});

describe("image loader integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shares normalization between preview/single OCR and all multi OCR branches", async () => {
    const image = render(PUBLIC_EVALUATION_CASES[0].image, "#000000", "#ffffff");
    const close = vi.fn();
    class FakeBitmap {
      width = image.width;
      height = image.height;
      close = close;
    }
    vi.stubGlobal("ImageBitmap", FakeBitmap);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(new FakeBitmap()));
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: () => ({ data: image.rgba }),
        }),
      }),
    });
    vi.stubGlobal("window", { setTimeout });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const file = new File(["fixture"], "test.png", { type: "image/png" });
    const variants = await loadImageAsBinaryGlyphVariants(file);
    const single = await loadImageAsBinaryGlyph(file);
    expect(variants).toHaveLength(6);
    expect(single).toEqual(variants[0].binary);
    expect(
      variants.every(
        (variant) =>
          variant.label.startsWith("明色文字を反転・") && variant.preprocessing?.inverted,
      ),
    ).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
