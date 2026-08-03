import { describe, expect, it } from "vitest";
import {
  calculatePannedScroll,
  clampCropZoom,
  cropZoomFromWheel,
  fitCropPreviewSize,
} from "../src/ui/crop-zoom";

describe("clampCropZoom", () => {
  it("表示倍率を100%から400%の範囲へ収める", () => {
    expect(clampCropZoom(0.5)).toBe(1);
    expect(clampCropZoom(2.25)).toBe(2.25);
    expect(clampCropZoom(5)).toBe(4);
  });
});

describe("fitCropPreviewSize", () => {
  it("画像の縦横比を保って表示領域へ収める", () => {
    expect(fitCropPreviewSize(1200, 600, 600)).toEqual({ width: 600, height: 300 });
  });

  it("縦長画像を最大表示高へ収める", () => {
    expect(fitCropPreviewSize(400, 1000, 800)).toEqual({ width: 168, height: 420 });
  });
});

describe("calculatePannedScroll", () => {
  it("ドラッグと反対方向へ表示位置を移動する", () => {
    expect(
      calculatePannedScroll({ x: 100, y: 80 }, { x: 300, y: 240 }, { x: 250, y: 210 }),
    ).toEqual({ x: 150, y: 110 });
  });

  it("表示位置を0未満にしない", () => {
    expect(calculatePannedScroll({ x: 5, y: 5 }, { x: 10, y: 10 }, { x: 30, y: 40 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("cropZoomFromWheel", () => {
  it("上回転で拡大し、下回転で縮小する", () => {
    expect(cropZoomFromWheel(2, -100)).toBe(2.25);
    expect(cropZoomFromWheel(2, 100)).toBe(1.75);
    expect(cropZoomFromWheel(2, 0)).toBe(2);
  });
});
