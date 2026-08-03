import { describe, expect, it } from "vitest";
import { evaluateRecognitionGeometry } from "../src/recognition/geometry-quality";

describe("evaluateRecognitionGeometry", () => {
  it("孤立した点と細い枠線を文字候補の異常として数える", () => {
    expect(
      evaluateRecognitionGeometry([
        { width: 24, height: 21 },
        { width: 9, height: 9 },
        { width: 20, height: 22 },
        { width: 1, height: 28 },
      ]),
    ).toEqual({ tinyFragments: 1, skinnyFragments: 1, penalty: 0.155 });
  });

  it("通常字形と70%程度の小書き字形は減点しない", () => {
    expect(
      evaluateRecognitionGeometry([
        { width: 20, height: 20 },
        { width: 14, height: 14 },
        { width: 21, height: 20 },
      ]).penalty,
    ).toBe(0);
  });
});
