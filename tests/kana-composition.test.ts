import { describe, expect, it } from "vitest";
import {
  composeKana,
  getSupportedModifiers,
  type KanaModifier,
} from "../src/domain/kana-composition";

describe("composeKana", () => {
  const dakutenRows = [
    ["かきくけこ", "がぎぐげご"],
    ["さしすせそ", "ざじずぜぞ"],
    ["たちつてと", "だぢづでど"],
    ["はひふへほ", "ばびぶべぼ"],
  ] as const;

  for (const [bases, expected] of dakutenRows) {
    it(`${bases}へ濁点を合成する`, () => {
      expect(
        [...bases]
          .map((baseKana) => composeKana(baseKana, "dakuten"))
          .map((result) => (result.ok ? result.kana : null)),
      ).toEqual([...expected]);
    });
  }

  it("は行へ半濁点を合成する", () => {
    expect(
      [..."はひふへほ"]
        .map((baseKana) => composeKana(baseKana, "handakuten"))
        .map((result) => (result.ok ? result.kana : null)),
    ).toEqual([..."ぱぴぷぺぽ"]);
  });

  it.each<[string, KanaModifier]>([
    ["あ", "dakuten"],
    ["か", "handakuten"],
  ])("未対応の %s + %s を推測しない", (baseKana, modifier) => {
    expect(composeKana(baseKana, modifier)).toEqual({
      ok: false,
      baseKana,
      modifier,
      reason: "unsupported-combination",
    });
  });
});

describe("getSupportedModifiers", () => {
  it("は行だけ濁点と半濁点の両方を返す", () => {
    expect(getSupportedModifiers("は")).toEqual(["dakuten", "handakuten"]);
    expect(getSupportedModifiers("か")).toEqual(["dakuten"]);
    expect(getSupportedModifiers("あ")).toEqual([]);
  });
});
