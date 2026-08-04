import { describe, expect, it } from "vitest";
import { resolvePublicAsset } from "../src/glyphs/assets";
import { findGlyphByKana, horizontalGlyphs } from "../src/glyphs/glyph-map";

describe("horizontalGlyphs", () => {
  it("基本46文字と長音記号を読み順どおりに定義する", () => {
    expect(horizontalGlyphs.map((glyph) => glyph.kana)).toEqual([
      "あ",
      "い",
      "う",
      "え",
      "お",
      "か",
      "き",
      "く",
      "け",
      "こ",
      "さ",
      "し",
      "す",
      "せ",
      "そ",
      "た",
      "ち",
      "つ",
      "て",
      "と",
      "な",
      "に",
      "ぬ",
      "ね",
      "の",
      "は",
      "ひ",
      "ふ",
      "へ",
      "ほ",
      "ま",
      "み",
      "む",
      "め",
      "も",
      "や",
      "ゆ",
      "よ",
      "ら",
      "り",
      "る",
      "れ",
      "ろ",
      "わ",
      "を",
      "ん",
      "ー",
    ]);
  });

  it("ID・かな・テンプレートパスが重複しない", () => {
    const ids = new Set(horizontalGlyphs.map((glyph) => glyph.id));
    const kana = new Set(horizontalGlyphs.map((glyph) => glyph.kana));
    const paths = new Set(horizontalGlyphs.map((glyph) => glyph.templatePath));

    expect(ids.size).toBe(horizontalGlyphs.length);
    expect(kana.size).toBe(horizontalGlyphs.length);
    expect(paths.size).toBe(horizontalGlyphs.length);
  });

  it("64×64の横書きSVGだけを参照する", () => {
    for (const glyph of horizontalGlyphs) {
      expect(glyph.direction).toBe("horizontal");
      expect(glyph.width).toBe(64);
      expect(glyph.height).toBe(64);
      expect(glyph.templatePath).toMatch(/^\/glyphs\/horizontal\/[a-z-]+\.svg$/);
    }
  });

  it("かなから字形を検索できる", () => {
    expect(findGlyphByKana("え")?.id).toBe("e");
    expect(
      ["あ", "い", "う", "え", "お"].every((kana) => findGlyphByKana(kana)?.supportsSmallForm),
    ).toBe(true);
    expect(findGlyphByKana("こ")?.id).toBe("ko");
    expect(findGlyphByKana("そ")?.id).toBe("so");
    expect(findGlyphByKana("つ")?.supportsSmallForm).toBe(true);
    expect(findGlyphByKana("ゆ")?.supportsSmallForm).toBe(true);
    expect(findGlyphByKana("わ")?.supportsSmallForm).toBe(false);
    expect(findGlyphByKana("ほ")?.supportsHandakuten).toBe(true);
    expect(findGlyphByKana("ー")?.id).toBe("long-vowel");
    expect(findGlyphByKana("未登録")).toBeUndefined();
  });
});

describe("resolvePublicAsset", () => {
  it("GitHub Pagesのbase配下へ解決する", () => {
    expect(resolvePublicAsset("/glyphs/horizontal/a.svg", "/hunter-moji-ocr/")).toBe(
      "/hunter-moji-ocr/glyphs/horizontal/a.svg",
    );
  });

  it("末尾スラッシュがないbaseも正規化する", () => {
    expect(resolvePublicAsset("/glyphs/horizontal/a.svg", "/preview")).toBe(
      "/preview/glyphs/horizontal/a.svg",
    );
  });
});
