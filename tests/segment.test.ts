import { describe, expect, it } from "vitest";
import type { BinaryGlyph } from "../src/recognition/features";
import { segmentHorizontalText } from "../src/recognition/segment";

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

describe("segmentHorizontalText", () => {
  it("下線直上の切り抜きでは下端に近い文字帯だけを選べる", () => {
    const source = glyph(100, 60, [
      [5, 5, 18, 10],
      [32, 6, 15, 9],
      [12, 30, 12, 22],
      [34, 30, 12, 22],
      [56, 30, 12, 22],
    ]);

    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      lineStrategy: "bottom-anchor",
    });

    expect(result.lineCount).toBe(1);
    expect(result.segments.map(({ x, y }) => [x, y])).toEqual([
      [12, 30],
      [34, 30],
      [56, 30],
    ]);
  });

  it("複数行を上から下、各行を左から右へ抽出する", () => {
    const source = glyph(80, 50, [
      [5, 5, 10, 14],
      [25, 5, 10, 14],
      [8, 30, 10, 14],
      [30, 30, 10, 14],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      maxInternalGapRatio: 0.1,
    });
    expect(result.lineCount).toBe(2);
    expect(result.segments.map(({ x, y }) => [x, y])).toEqual([
      [5, 5],
      [25, 5],
      [8, 30],
      [30, 30],
    ]);
  });

  it("近接する離れた線と点を1文字へまとめる", () => {
    const source = glyph(60, 30, [
      [5, 5, 6, 18],
      [15, 7, 4, 4],
      [35, 5, 8, 18],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      maxInternalGapRatio: 0.25,
    });
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ x: 5, width: 14 });
  });

  it("小さな孤立ノイズを除去する", () => {
    const source = glyph(50, 30, [
      [8, 5, 10, 18],
      [40, 2, 1, 1],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].x).toBe(8);
  });

  it("横に長すぎる候補を投影の谷で再分割する", () => {
    const source = glyph(70, 32, [
      [6, 6, 14, 20],
      [23, 6, 14, 20],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      maxInternalGapRatio: 0.25,
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments.map(({ x, width }) => [x, width])).toEqual([
      [6, 14],
      [23, 14],
    ]);
  });

  it("横長でも十分な分割谷がない1文字は維持する", () => {
    const source = glyph(50, 30, [[6, 6, 32, 18]]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ x: 6, width: 32 });
  });

  it("複雑な背景でつながった横長候補は浅い谷でも再分割する", () => {
    const source = glyph(90, 40, [
      [5, 8, 25, 24],
      [34, 8, 25, 24],
      [63, 8, 20, 24],
      [30, 18, 4, 4],
      [59, 18, 4, 4],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      maxInternalGapRatio: 0.25,
    });

    expect(result.segments).toHaveLength(3);
  });

  it("共通ベースラインより上へ伸びる背景線を除いて再分割する", () => {
    const source = glyph(100, 40, [
      [5, 20, 10, 12],
      [7, 2, 2, 20],
      [25, 20, 10, 12],
      [27, 2, 2, 20],
      [50, 20, 10, 12],
      [70, 20, 10, 12],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 4,
      minLineHeight: 5,
      applyOpening: false,
      maxInternalGapRatio: 0.1,
    });
    expect(result.segments).toHaveLength(4);
    expect(result.segments.map(({ y, height }) => [y, height])).toEqual([
      [18, 14],
      [18, 14],
      [20, 12],
      [20, 12],
    ]);
    expect(result.segments.every((segment) => segment.baselineAdjusted)).toBe(true);
  });

  it("高解像度でも細い文字線をオープニング処理で消さない", () => {
    const source = glyph(400, 400, [
      [40, 120, 2, 80],
      [100, 120, 2, 80],
    ]);
    const result = segmentHorizontalText(source, {
      minComponentArea: 20,
      minLineHeight: 5,
      maxInternalGapRatio: 0.1,
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments.map(({ x }) => x)).toEqual([40, 100]);
  });
});
