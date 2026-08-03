import { describe, expect, it } from "vitest";
import { composeSmallKana, SMALL_KANA_BASES } from "../src/domain/small-kana";
import type { BinaryGlyph } from "../src/recognition/features";
import { findForegroundBounds } from "../src/recognition/normalize";
import { createSmallBinaryGlyph } from "../src/recognition/small-glyph";

describe("composeSmallKana", () => {
  it("つ・や・ゆ・よを小書きかなへ変換する", () => {
    expect(SMALL_KANA_BASES).toEqual(["つ", "や", "ゆ", "よ"]);
    expect(SMALL_KANA_BASES.map((kana) => composeSmallKana(kana))).toEqual([
      { ok: true, baseKana: "つ", kana: "っ" },
      { ok: true, baseKana: "や", kana: "ゃ" },
      { ok: true, baseKana: "ゆ", kana: "ゅ" },
      { ok: true, baseKana: "よ", kana: "ょ" },
    ]);
  });

  it("対応外の基底文字を推測しない", () => {
    expect(composeSmallKana("あ")).toEqual({
      ok: false,
      baseKana: "あ",
      reason: "unsupported-base",
    });
  });
});

describe("createSmallBinaryGlyph", () => {
  const source: BinaryGlyph = {
    width: 8,
    height: 8,
    pixels: Uint8Array.from(
      Array.from({ length: 64 }, (_, index) => {
        const x = index % 8;
        const y = Math.floor(index / 8);
        return x >= 1 && x <= 6 && y >= 2 && y <= 5 ? 1 : 0;
      }),
    ),
  };

  it("前景を中央に保ちながら70%へ縮小する", () => {
    expect(findForegroundBounds(createSmallBinaryGlyph(source))).toEqual({
      x: 2,
      y: 2,
      width: 4,
      height: 3,
    });
  });

  it("不正な倍率を拒否する", () => {
    expect(() => createSmallBinaryGlyph(source, 1)).toThrow(
      "小書き字形の倍率は0より大きく1未満で指定してください。",
    );
  });
});
