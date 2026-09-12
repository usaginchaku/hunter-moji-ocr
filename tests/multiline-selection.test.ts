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

describe("confident complete lines", () => {
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
