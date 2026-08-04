import { describe, expect, it } from "vitest";
import {
  computeGeneratorGlyphLayout,
  findOpaqueHorizontalBounds,
} from "../src/generator/glyph-layout";

describe("generator glyph layout", () => {
  it("マスクの不透明画素から本体の横境界を抽出する", () => {
    const rgba = new Uint8ClampedArray(4 * 3 * 4);
    for (const [x, y] of [
      [1, 0],
      [2, 1],
      [3, 2],
    ])
      rgba[(y * 4 + x) * 4 + 3] = 255;

    expect(findOpaqueHorizontalBounds(rgba, 4, 3)).toEqual({
      left: 1,
      right: 4,
      sourceWidth: 4,
    });
    expect(findOpaqueHorizontalBounds(new Uint8ClampedArray(4 * 3 * 4), 4, 3)).toBeNull();
  });

  it("右端まで伸びる本体と濁点の間に最低間隔を確保する", () => {
    const layout = computeGeneratorGlyphLayout(
      { left: 11, right: 58, sourceWidth: 64 },
      32,
      96,
      1,
      "dakuten",
    );
    const modifierLeft = layout.modifierCenterX! - layout.modifierOuterRadius;

    expect(modifierLeft).toBeGreaterThanOrEqual(layout.bodyRight + layout.minimumGap - 1e-9);
    expect(layout.bodyLeft).toBeGreaterThanOrEqual(32);
    expect(layout.modifierCenterX! + layout.modifierOuterRadius).toBeLessThanOrEqual(32 + 96);
    expect(layout.drawSize).toBe(96);
    expect(layout.drawX).toBeLessThan(32);
  });

  it("右側に余白がある本体は従来位置を維持する", () => {
    const layout = computeGeneratorGlyphLayout(
      { left: 20, right: 43, sourceWidth: 64 },
      10,
      80,
      1,
      "dakuten",
    );

    expect(layout.drawX).toBe(10);
    expect(layout.drawSize).toBe(80);
    expect(layout.modifierCenterX).toBeCloseTo(10 + 80 * 0.82);
  });

  it("半濁点の線幅を含めて間隔とセル内配置を保証する", () => {
    const layout = computeGeneratorGlyphLayout(
      { left: 0, right: 64, sourceWidth: 64 },
      0,
      48,
      1,
      "handakuten",
    );
    const modifierLeft = layout.modifierCenterX! - layout.modifierOuterRadius;

    expect(modifierLeft).toBeGreaterThanOrEqual(layout.bodyRight + layout.minimumGap - 1e-9);
    expect(layout.bodyLeft).toBeGreaterThanOrEqual(0);
    expect(layout.modifierCenterX! + layout.modifierOuterRadius).toBeLessThanOrEqual(48);
    expect(layout.drawSize).toBeLessThan(48);
  });

  it("修飾なしと小書きの従来の中央・下揃え用サイズを変えない", () => {
    const normal = computeGeneratorGlyphLayout(
      { left: 11, right: 58, sourceWidth: 64 },
      24,
      96,
      1,
      null,
    );
    const small = computeGeneratorGlyphLayout(
      { left: 11, right: 58, sourceWidth: 64 },
      24,
      96,
      0.7,
      null,
    );

    expect(normal).toMatchObject({ drawX: 24, drawSize: 96, modifierCenterX: null });
    expect(small.modifierCenterX).toBeNull();
    expect(small.drawX).toBeCloseTo(38.4);
    expect(small.drawSize).toBeCloseTo(67.2);
  });
});
