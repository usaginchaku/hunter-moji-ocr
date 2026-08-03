import { describe, expect, it } from "vitest";
import {
  assessSmallFormInLine,
  detectSmallFormInLine,
} from "../src/recognition/small-form-detection";

describe("detectSmallFormInLine", () => {
  const normal = [
    { lineIndex: 0, y: 2, height: 20 },
    { lineIndex: 0, y: 2, height: 20 },
    { lineIndex: 0, y: 2, height: 20 },
  ];

  it("同じベースライン上の縮小字形を小書きと判定する", () => {
    const small = { lineIndex: 0, y: 8, height: 14 };
    expect(detectSmallFormInLine(small, [...normal, small])).toBe(true);
  });

  it("上付きの小さな点や記号を小書きにしない", () => {
    const upper = { lineIndex: 0, y: 2, height: 8 };
    expect(detectSmallFormInLine(upper, [...normal, upper])).toBe(false);
  });

  it("行内に比較対象がない場合は推測しない", () => {
    const only = { lineIndex: 0, y: 2, height: 14 };
    expect(detectSmallFormInLine(only, [only])).toBe(false);
    expect(assessSmallFormInLine(only, [only]).ambiguous).toBe(true);
  });

  it("しきい値付近のサイズを要確認として返す", () => {
    const borderline = { lineIndex: 0, y: 6, height: 16 };
    expect(assessSmallFormInLine(borderline, [...normal, borderline])).toMatchObject({
      isSmall: true,
      ambiguous: true,
    });
  });
});
