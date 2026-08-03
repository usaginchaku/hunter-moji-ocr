import { describe, expect, it } from "vitest";
import { horizontalGlyphs } from "../src/glyphs/glyph-map";
import type { GlyphCandidate } from "../src/recognition/similarity";
import { buildCorrectionChoices } from "../src/ui/correction-choices";

describe("buildCorrectionChoices", () => {
  it("上位候補を先頭に保ち、長音を含む47文字を重複なく返す", () => {
    const candidates: GlyphCandidate[] = [
      {
        templateId: "mo",
        kana: "も",
        score: 0.585,
        scoreBreakdown: {
          bitmap: 0,
          projection: 0,
          aspectRatio: 0,
          foreground: 0,
          components: 0,
          spatial: 0,
        },
      },
      {
        templateId: "ru",
        kana: "る",
        score: 0.568,
        scoreBreakdown: {
          bitmap: 0,
          projection: 0,
          aspectRatio: 0,
          foreground: 0,
          components: 0,
          spatial: 0,
        },
      },
      {
        templateId: "n",
        kana: "ん",
        score: 0.553,
        scoreBreakdown: {
          bitmap: 0,
          projection: 0,
          aspectRatio: 0,
          foreground: 0,
          components: 0,
          spatial: 0,
        },
      },
    ];

    const choices = buildCorrectionChoices(candidates, horizontalGlyphs);
    const all = [...choices.topCandidates, ...choices.otherGlyphs];

    expect(choices.topCandidates.map(({ kana }) => kana)).toEqual(["も", "る", "ん"]);
    expect(all).toHaveLength(47);
    expect(new Set(all.map(({ templateId }) => templateId)).size).toBe(47);
    expect(choices.otherGlyphs.some(({ kana }) => kana === "し")).toBe(true);
  });
});
