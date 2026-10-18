import { describe, expect, it } from "vitest";
import type { LoadedGlyphTemplate } from "../src/glyphs/load-templates";
import { extractBasicFeatures } from "../src/recognition/features";
import { normalizeBinaryGlyph } from "../src/recognition/normalize";
import { runRecognitionPipeline } from "../src/recognition/recognition-pipeline";
import {
  PUBLIC_EVALUATION_CASES,
  PUBLIC_EVALUATION_GLYPHS,
} from "./fixtures/public-evaluation-set";
import type { ImagePreprocessing } from "../src/image/preprocess";

const templates: LoadedGlyphTemplate[] = PUBLIC_EVALUATION_GLYPHS.map((glyph) => {
  const binary = normalizeBinaryGlyph(glyph.binary);
  return {
    definition: {
      id: glyph.id,
      kana: glyph.kana,
      direction: "horizontal",
      templatePath: `self-made://${glyph.id}`,
      width: 64,
      height: 64,
      status: "ready",
      supportsDakuten: false,
      supportsHandakuten: false,
      supportsSmallForm: false,
    },
    binary,
    features: extractBasicFeatures(binary),
  };
});

function recognize(preprocessing?: ImagePreprocessing, mode: "auto" | "background" = "auto") {
  return runRecognitionPipeline(
    [
      {
        mode: "background",
        label: "背景色との差",
        binary: PUBLIC_EVALUATION_CASES[3].image,
        preprocessing,
      },
    ],
    templates,
    mode,
  ).selected;
}

const simpleBackground: ImagePreprocessing = {
  polarity: "dark-text",
  inverted: false,
  contrastAdjusted: false,
  detectionThreshold: 0,
  separation: 1,
  darkFraction: 0.1,
  borderDarkFraction: 0,
  luminanceRange: [0, 255],
};

describe("framed background recovery", () => {
  function surfaceVariants(clipped: boolean) {
    const source = PUBLIC_EVALUATION_CASES[0].image;
    const pixels = source.pixels.slice();
    if (clipped) {
      pixels.fill(0);
      for (let y = 0; y < source.height; y++)
        for (let x = 2; x < source.width; x++)
          pixels[y * source.width + x - 2] = source.pixels[y * source.width + x];
    }
    return [
      {
        mode: "background" as const,
        label: "背景色との差",
        binary: { ...source, pixels: new Uint8Array(source.pixels.length) },
      },
      {
        mode: "background" as const,
        label: "背景色との差（背景面補正）",
        backgroundCorrected: true,
        binary: { ...source, pixels },
      },
    ];
  }

  it("余白内に収まる字形を背景面の候補から回復する", () => {
    const selected = runRecognitionPipeline(surfaceVariants(false), templates, "auto").selected;
    expect(selected?.id).toBe("background-surface");
    expect(selected?.recognized.map((glyph) => glyph.automaticBaseKana).join("")).toBe("あいう");
  });

  it("画像端で途切れる候補を自動回復の根拠にしない", () => {
    expect(runRecognitionPipeline(surfaceVariants(true), templates, "auto").selected).toBeNull();
  });

  it("手動方式の従来の候補を補正候補で置き換えない", () => {
    expect(
      runRecognitionPipeline(surfaceVariants(false), templates, "background").selected,
    ).toBeNull();
  });
});

function shortLineImage(isolated = false) {
  const width = 45;
  const height = 48;
  const pixels = new Uint8Array(width * height);
  const placements: [number, number, number][] = [
    [0, 3, 3],
    [1, 14, 3],
    [2, isolated ? 34 : 3, 19],
    [1, 3, 35],
    [0, 14, 35],
  ];
  for (const [index, x, y] of placements) {
    const glyph = PUBLIC_EVALUATION_GLYPHS[index].binary;
    for (let row = 0; row < glyph.height; row++)
      for (let column = 0; column < glyph.width; column++)
        pixels[(y + row) * width + x + column] = glyph.pixels[row * glyph.width + column];
  }
  return { width, height, pixels };
}

function recognizeShortLine(isolated = false) {
  const calibrated = templates.map((template, index) => {
    const { width, height } = PUBLIC_EVALUATION_GLYPHS[index].binary;
    return {
      ...template,
      sourceBounds: { x: 12, y: 4, width: width * 8, height: height * 8 },
    };
  });
  return runRecognitionPipeline(
    [
      {
        mode: "background",
        label: "背景色との差",
        binary: shortLineImage(isolated),
        preprocessing: simpleBackground,
      },
    ],
    calibrated,
    "auto",
  ).selected;
}

describe("confident complete lines", () => {
  it("文字サイズと隣の行の範囲が揃う1文字行を保持する", () => {
    const selected = recognizeShortLine();
    expect(selected?.id).toBe("background");
    expect(selected?.recognized.map((glyph) => glyph.automaticBaseKana).join("")).toBe(
      "あいういあ",
    );
  });

  it("字形が似ていても本文の外に孤立した候補では全行へ切り替えない", () => {
    expect(recognizeShortLine(true)?.id).toBe("background-bottom-anchor");
  });
  it.each(["dark-text", "light-text"] as const)(
    "retains both recognized lines for %s",
    (polarity) => {
      const selected = recognize({ ...simpleBackground, polarity });
      expect(selected?.id).toBe("background");
      expect(selected?.lineCount).toBe(2);
      expect(selected?.recognized.map((glyph) => glyph.automaticBaseKana).join("")).toBe(
        "あいうあ",
      );
    },
  );

  it("retains the existing fallback for uncertain backgrounds or missing metadata", () => {
    expect(recognize()?.id).toBe("background-bottom-anchor");
    expect(recognize({ ...simpleBackground, polarity: "undetermined" })?.id).toBe(
      "background-bottom-anchor",
    );
    expect(recognize({ ...simpleBackground, separation: 0.89 })?.id).toBe(
      "background-bottom-anchor",
    );
  });

  it("does not replace the fallback when the discarded line has ambiguous candidates", () => {
    const ambiguousTemplates = [
      ...templates,
      {
        ...templates[1],
        definition: { ...templates[1].definition, id: "zz-ambiguous-i", kana: "え" },
      },
    ];
    const result = runRecognitionPipeline(
      [
        {
          mode: "background",
          label: "背景色との差",
          binary: PUBLIC_EVALUATION_CASES[3].image,
          preprocessing: simpleBackground,
        },
      ],
      ambiguousTemplates,
      "auto",
    );
    expect(result.selected?.id).toBe("background-bottom-anchor");
  });

  it("keeps an explicitly selected mode", () => {
    expect(recognize({ ...simpleBackground, polarity: "undetermined" }, "background")?.id).toBe(
      "background",
    );
  });
});
