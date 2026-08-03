import { describe, expect, it } from "vitest";
import type { BinaryGlyph } from "../src/recognition/features";
import { detectHorizontalModifier } from "../src/recognition/modifier-detection";

function glyph(
  width: number,
  height: number,
  rectangles: Array<[number, number, number, number]>,
): BinaryGlyph {
  const pixels = new Uint8Array(width * height);
  for (const [x, y, rectWidth, rectHeight] of rectangles) {
    for (let offsetY = 0; offsetY < rectHeight; offsetY += 1) {
      for (let offsetX = 0; offsetX < rectWidth; offsetX += 1)
        pixels[(y + offsetY) * width + x + offsetX] = 1;
    }
  }
  return { width, height, pixels };
}

describe("detectHorizontalModifier", () => {
  it("基底字形の右下にある小さな黒丸を濁点として分離する", () => {
    const source = glyph(18, 22, [
      [2, 2, 5, 16],
      [8, 16, 3, 3],
    ]);
    const result = detectHorizontalModifier(source);
    expect(result.modifier).toBe("dakuten");
    expect(result.base.width).toBe(5);
    expect([...result.base.pixels].reduce((sum, value) => sum + value, 0)).toBe(80);
  });

  it("内部に穴がある右下の輪を半濁点として分離する", () => {
    const source = glyph(20, 24, [[2, 2, 5, 18]]);
    for (let y = 16; y < 21; y += 1) {
      for (let x = 8; x < 13; x += 1) {
        if (x === 8 || x === 12 || y === 16 || y === 20) source.pixels[y * source.width + x] = 1;
      }
    }
    const result = detectHorizontalModifier(source);
    expect(result.modifier).toBe("handakuten");
    expect(result.base.width).toBe(5);
  });

  it("字形内の大きな円や中央の点は修飾記号にしない", () => {
    const source = glyph(20, 20, [
      [2, 2, 5, 16],
      [8, 6, 6, 6],
    ]);
    expect(detectHorizontalModifier(source).modifier).toBeNull();
  });

  it("細線の本体に対して相対的に大きい半濁点も検出する", () => {
    const source = glyph(30, 22, [
      [2, 2, 3, 18],
      [2, 17, 12, 3],
    ]);
    for (let y = 11; y < 20; y += 1) {
      for (let x = 16; x < 25; x += 1) {
        if (x === 16 || x === 24 || y === 11 || y === 19) {
          source.pixels[y * source.width + x] = 1;
        }
      }
    }

    expect(detectHorizontalModifier(source).modifier).toBe("handakuten");
  });
});
