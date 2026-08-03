import { describe, expect, it } from "vitest";
import type { BinaryGlyph } from "../src/recognition/features";
import { associateDetachedHorizontalModifiers } from "../src/recognition/modifier-association";
import type { TextSegment } from "../src/recognition/segment";

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

function segment(
  id: string,
  x: number,
  y: number,
  binary: BinaryGlyph,
  lineIndex = 0,
): TextSegment {
  return {
    id,
    lineIndex,
    x,
    y,
    width: binary.width,
    height: binary.height,
    relativeHeight: 1,
    binary,
  };
}

function base(id: string, x: number, lineIndex = 0): TextSegment {
  return segment(
    id,
    x,
    2,
    glyph(14, 20, [
      [1, 1, 4, 18],
      [1, 16, 12, 3],
    ]),
    lineIndex,
  );
}

function dot(id: string, x: number, lineIndex = 0): TextSegment {
  return segment(id, x, 16, glyph(3, 3, [[0, 0, 3, 3]]), lineIndex);
}

describe("associateDetachedHorizontalModifiers", () => {
  it("本体と修飾記号の元画像・元IDを別々に保持する", () => {
    const baseSegment = base("base", 10);
    const markSegment = dot("mark", 26);
    const result = associateDetachedHorizontalModifiers([baseSegment, markSegment]);

    expect(result).toHaveLength(1);
    expect(result[0].modifierAttachment).toMatchObject({
      baseSourceId: "base",
      markSourceId: "mark",
      modifier: "dakuten",
    });
    expect(result[0].modifierAttachment?.baseBinary).toBe(baseSegment.binary);
    expect(result[0].modifierAttachment?.markBinary).toBe(markSegment.binary);
  });

  it("競合する記号を最も適合する一つの本体だけへ関連付ける", () => {
    const left = base("left", 0);
    const right = base("right", 15);
    const mark = dot("mark", 31);
    const result = associateDetachedHorizontalModifiers([left, right, mark]);

    expect(result).toHaveLength(2);
    expect(result.filter(({ modifierAttachment }) => modifierAttachment)).toHaveLength(1);
    expect(
      result.find(({ modifierAttachment }) => modifierAttachment)?.modifierAttachment,
    ).toMatchObject({ baseSourceId: "right", markSourceId: "mark" });
  });

  it("別行の小成分を関連付けず、どちらも失わない", () => {
    const baseSegment = base("base", 10, 0);
    const otherLineMark = dot("mark", 26, 1);
    const result = associateDetachedHorizontalModifiers([baseSegment, otherLineMark]);

    expect(result).toHaveLength(2);
    expect(result.every(({ modifierAttachment }) => !modifierAttachment)).toBe(true);
  });
});
