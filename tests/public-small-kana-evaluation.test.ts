import { describe, expect, it } from "vitest";
import { composeKana } from "../src/domain/kana-composition";
import { composeSmallKana } from "../src/domain/small-kana";
import { createGeneratorTextPlan } from "../src/generator/text-plan";
import { horizontalGlyphs } from "../src/glyphs/glyph-map";
import smallASvg from "../public/glyphs/small/small-a.svg?raw";
import smallESvg from "../public/glyphs/small/small-e.svg?raw";
import smallISvg from "../public/glyphs/small/small-i.svg?raw";
import smallOSvg from "../public/glyphs/small/small-o.svg?raw";
import smallUSvg from "../public/glyphs/small/small-u.svg?raw";

const SMALL_VOWELS = [
  { baseKana: "あ", kana: "ぁ", svg: smallASvg },
  { baseKana: "い", kana: "ぃ", svg: smallISvg },
  { baseKana: "う", kana: "ぅ", svg: smallUSvg },
  { baseKana: "え", kana: "ぇ", svg: smallESvg },
  { baseKana: "お", kana: "ぉ", svg: smallOSvg },
] as const;

describe("公開可能な独自SVG小書き母音の回帰評価", () => {
  it("独自SVG 5種と合成仕様が1対1で一致する", () => {
    const results = SMALL_VOWELS.map(({ baseKana, kana, svg }) => {
      return {
        kana,
        composition: composeSmallKana(baseKana),
        hasExpectedTitle: svg.includes(`<title id="title">ハンター文字 ${kana}</title>`),
        hasExpectedScale: svg.includes('transform="translate(9.6 9.6) scale(.7)"'),
        isStandaloneSvg: svg.startsWith("<svg ") && svg.trimEnd().endsWith("</svg>"),
      };
    });

    expect(results).toEqual(
      SMALL_VOWELS.map(({ baseKana, kana }) => ({
        kana,
        composition: { ok: true, baseKana, kana },
        hasExpectedTitle: true,
        hasExpectedScale: true,
        isStandaloneSvg: true,
      })),
    );
  });

  it("手動出力・画像メーカー・出力81かなが5種すべてに対応する", () => {
    const source = SMALL_VOWELS.map(({ kana }) => kana).join("");
    const plan = createGeneratorTextPlan(source, SMALL_VOWELS.length);
    const glyphTokens = plan.lines.flat().filter((token) => token.kind === "glyph");
    const outputKana = new Set<string>(horizontalGlyphs.map(({ kana }) => kana));
    for (const glyph of horizontalGlyphs) {
      for (const modifier of ["dakuten", "handakuten"] as const) {
        const composed = composeKana(glyph.kana, modifier);
        if (composed.ok) outputKana.add(composed.kana);
      }
      const small = composeSmallKana(glyph.kana);
      if (small.ok) outputKana.add(small.kana);
    }

    expect(plan.unsupported).toEqual([]);
    expect(glyphTokens.map(({ source }) => source)).toEqual([...source]);
    expect(glyphTokens.every(({ small }) => small)).toBe(true);
    expect(horizontalGlyphs).toHaveLength(47);
    expect(outputKana).toHaveLength(81);
  });
});
