import { describe, expect, it } from "vitest";
import { rgbaToBinaryGlyph } from "../src/glyphs/load-templates";
import { extractBasicFeatures } from "../src/recognition/features";

describe("rgbaToBinaryGlyph", () => {
  it("透明背景を背景、黒い画素を前景として変換する", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]);

    expect(Array.from(rgbaToBinaryGlyph(rgba, 2, 1).pixels)).toEqual([0, 1]);
  });

  it("RGBAサイズの不一致を拒否する", () => {
    expect(() => rgbaToBinaryGlyph(new Uint8ClampedArray(4), 2, 2)).toThrow(
      "RGBA画像のサイズと画素数が一致しません。",
    );
  });
});

describe("extractBasicFeatures", () => {
  it("前景率・縦横比・射影を計算する", () => {
    const features = extractBasicFeatures({
      width: 3,
      height: 2,
      pixels: Uint8Array.from([1, 0, 0, 1, 1, 0]),
    });

    expect(features.foregroundRatio).toBe(0.5);
    expect(features.aspectRatio).toBe(1);
    expect(features.projectionX).toEqual([1, 0.5, 0]);
    expect(features.projectionY[0]).toBeCloseTo(1 / 3);
    expect(features.projectionY[1]).toBeCloseTo(2 / 3);
    expect(features.componentCount).toBe(1);
    expect(features.spatialGrid).toHaveLength(16);
    expect(features.spatialGrid.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("空の字形では縦横比を0にする", () => {
    const features = extractBasicFeatures({
      width: 2,
      height: 2,
      pixels: new Uint8Array(4),
    });

    expect(features.foregroundRatio).toBe(0);
    expect(features.aspectRatio).toBe(0);
    expect(features.componentCount).toBe(0);
    expect(features.spatialGrid).toEqual(Array.from({ length: 16 }, () => 0));
  });

  it("字形サイズと画素数の不一致を拒否する", () => {
    expect(() => extractBasicFeatures({ width: 2, height: 2, pixels: new Uint8Array(3) })).toThrow(
      "字形サイズと画素数が一致しません。",
    );
  });
});
