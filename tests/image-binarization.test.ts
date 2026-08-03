import { describe, expect, it } from "vitest";
import {
  rgbaToAdaptiveBinaryGlyph,
  rgbaToDarkInkBinaryGlyph,
  rgbaToLocalColorContrastBinaryGlyph,
  rgbaToLocalContrastBinaryGlyph,
  rgbaToNeutralInkBinaryGlyph,
  rgbaToSauvolaBinaryGlyph,
} from "../src/image/load";

function rgba(pixels: Array<[number, number, number]>): Uint8ClampedArray {
  return Uint8ClampedArray.from(pixels.flatMap(([red, green, blue]) => [red, green, blue, 255]));
}

describe("rgbaToAdaptiveBinaryGlyph", () => {
  it("白背景の黒文字を前景にする", () => {
    const result = rgbaToAdaptiveBinaryGlyph(
      rgba([
        [255, 255, 255],
        [0, 0, 0],
        [255, 255, 255],
      ]),
      3,
      1,
    );
    expect([...result.pixels]).toEqual([0, 1, 0]);
  });

  it("淡い背景のオレンジ文字を検出し、弱い色むらを無視する", () => {
    const result = rgbaToAdaptiveBinaryGlyph(
      rgba([
        [245, 248, 242],
        [255, 102, 0],
        [230, 238, 232],
        [245, 248, 242],
      ]),
      4,
      1,
    );
    expect([...result.pixels]).toEqual([0, 1, 0, 0]);
  });

  it("RGBAサイズの不一致を拒否する", () => {
    expect(() => rgbaToAdaptiveBinaryGlyph(new Uint8ClampedArray(4), 2, 2)).toThrow(
      "RGBA画像のサイズと画素数が一致しません",
    );
  });
});

describe("background-aware binarization variants", () => {
  it("黒い線優先では明るい高彩度背景を除外する", () => {
    const result = rgbaToDarkInkBinaryGlyph(
      rgba([
        [240, 145, 180],
        [18, 20, 19],
        [245, 230, 120],
        [232, 160, 190],
      ]),
      4,
      1,
    );
    expect([...result.pixels]).toEqual([0, 1, 0, 0]);
  });

  it("局所コントラストでは色の異なる背景上の暗線を拾う", () => {
    const pixels: Array<[number, number, number]> = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        pixels.push(x === 2 ? [20, 20, 20] : y < 3 ? [240, 180, 200] : [235, 220, 150]);
      }
    }
    const result = rgbaToLocalContrastBinaryGlyph(rgba(pixels), 5, 5);
    expect([0, 1, 2, 3, 4].map((y) => result.pixels[y * 5 + 2])).toEqual([1, 1, 1, 1, 1]);
    expect(result.pixels[0]).toBe(0);
  });

  it("Sauvola方式では明るさが変化する背景から中立色の暗線を抽出する", () => {
    const pixels: Array<[number, number, number]> = [];
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        const background = 185 + x * 6;
        pixels.push(x === 4 ? [35, 35, 35] : [background, background, background]);
      }
    }
    const result = rgbaToSauvolaBinaryGlyph(rgba(pixels), 9, 9);
    expect(Array.from({ length: 9 }, (_, y) => result.pixels[y * 9 + 4])).toEqual(
      Array.from({ length: 9 }, () => 1),
    );
    expect(result.pixels[0]).toBe(0);
  });

  it("Sauvola方式では高彩度の人物色を文字として拾いにくくする", () => {
    const result = rgbaToSauvolaBinaryGlyph(
      rgba([
        [230, 180, 195],
        [45, 45, 45],
        [85, 10, 95],
        [230, 180, 195],
      ]),
      4,
      1,
    );
    expect([...result.pixels]).toEqual([0, 1, 0, 0]);
  });

  it("無彩色の黒線方式では暗い有彩色を除外する", () => {
    const pixels: Array<[number, number, number]> = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (x === 1) pixels.push([25, 25, 25]);
        else if (x === 3) pixels.push([70, 20, 80]);
        else pixels.push([230, 180, 195]);
      }
    }
    const result = rgbaToNeutralInkBinaryGlyph(rgba(pixels), 5, 5);
    expect(Array.from({ length: 5 }, (_, y) => result.pixels[y * 5 + 1])).toEqual([1, 1, 1, 1, 1]);
    expect(Array.from({ length: 5 }, (_, y) => result.pixels[y * 5 + 3])).toEqual([0, 0, 0, 0, 0]);
  });

  it("local color contrast keeps dark neutral strokes across colored backgrounds", () => {
    const pixels: Array<[number, number, number]> = [];
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        const background: [number, number, number] = x < 4 ? [235, 165, 190] : [235, 220, 135];
        pixels.push(x === 4 ? [28, 30, 29] : background);
      }
    }
    const result = rgbaToLocalColorContrastBinaryGlyph(rgba(pixels), 9, 9);

    expect(Array.from({ length: 9 }, (_, y) => result.pixels[y * 9 + 4])).toEqual(
      Array.from({ length: 9 }, () => 1),
    );
    expect(result.pixels[0]).toBe(0);
    expect(result.pixels[8]).toBe(0);
  });
});
