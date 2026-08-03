import { describe, expect, it } from "vitest";
import { calculateProcessingSize, resolveCropBounds } from "../src/image/load";

describe("resolveCropBounds", () => {
  it("指定なしでは画像全体を返す", () => {
    expect(resolveCropBounds(1200, 800)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it("正規化範囲を元画像のピクセルへ変換する", () => {
    expect(resolveCropBounds(1200, 800, { x: 0.25, y: 0.1, width: 0.5, height: 0.75 })).toEqual({
      x: 300,
      y: 80,
      width: 600,
      height: 600,
    });
  });

  it("小さな有効範囲も最低1ピクセル残す", () => {
    expect(resolveCropBounds(10, 10, { x: 0.99, y: 0.99, width: 0.01, height: 0.01 })).toEqual({
      x: 9,
      y: 9,
      width: 1,
      height: 1,
    });
  });

  it("画像外と空の範囲を拒否する", () => {
    expect(() => resolveCropBounds(100, 100, { x: 0.8, y: 0, width: 0.3, height: 1 })).toThrow(
      "切り抜き範囲は画像内",
    );
    expect(() => resolveCropBounds(100, 100, { x: 0, y: 0, width: 0, height: 1 })).toThrow(
      "切り抜き範囲は画像内",
    );
  });
});

describe("calculateProcessingSize", () => {
  it("小さい画像は拡大しない", () => {
    expect(calculateProcessingSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it("巨大画像を縦横比を保って最大2048pxへ縮小する", () => {
    expect(calculateProcessingSize(8000, 4000)).toEqual({
      width: 2048,
      height: 1024,
      scale: 0.256,
    });
  });
});
