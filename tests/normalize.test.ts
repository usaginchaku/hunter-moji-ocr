import { describe, expect, it } from "vitest";
import type { BinaryGlyph } from "../src/recognition/features";
import { findForegroundBounds, normalizeBinaryGlyph } from "../src/recognition/normalize";

function glyph(width: number, height: number, foreground: Array<[number, number]>): BinaryGlyph {
  const pixels = new Uint8Array(width * height);
  for (const [x, y] of foreground) pixels[y * width + x] = 1;
  return { width, height, pixels };
}

describe("normalizeBinaryGlyph", () => {
  it("密度の高い小型記号は拡大しすぎず中央へ配置する", () => {
    const result = normalizeBinaryGlyph(glyph(6, 6, [[4, 3]]), 8, 2);
    expect(findForegroundBounds(result)).toEqual({ x: 3, y: 3, width: 1, height: 1 });
  });

  it("縦横比を保ったまま正規化する", () => {
    const source = glyph(5, 4, [
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(findForegroundBounds(normalizeBinaryGlyph(source, 10, 1))).toEqual({
      x: 1,
      y: 3,
      width: 8,
      height: 3,
    });
  });

  it("線が密集した字形を小型記号として誤判定しない", () => {
    const source = glyph(3, 3, [
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [2, 2],
    ]);
    expect(findForegroundBounds(normalizeBinaryGlyph(source, 9, 0))).toEqual({
      x: 0,
      y: 0,
      width: 9,
      height: 9,
    });
  });

  it("前景がなければ空の正規化画像を返す", () => {
    const result = normalizeBinaryGlyph(glyph(2, 2, []), 4, 1);
    expect(Array.from(result.pixels)).toEqual(Array(16).fill(0));
  });

  it("広すぎる余白を拒否する", () => {
    expect(() => normalizeBinaryGlyph(glyph(2, 2, []), 8, 4)).toThrow(
      "余白は正規化サイズの半分未満の整数で指定してください。",
    );
  });
});
