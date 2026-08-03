import { describe, expect, it } from "vitest";
import {
  isSmallFormCandidate,
  orderHorizontalCandidates,
  type CharacterCandidate,
} from "../src/recognition/reading-order";

describe("orderHorizontalCandidates", () => {
  it("横書き候補を上の行から下の行、各行は左から右へ並べる", () => {
    const candidates: CharacterCandidate[] = [
      { id: "下右", x: 44, y: 42, width: 14, height: 20 },
      { id: "上右", x: 48, y: 9, width: 15, height: 20 },
      { id: "下左", x: 8, y: 40, width: 15, height: 20 },
      { id: "上左", x: 7, y: 11, width: 14, height: 20 },
    ];

    const result = orderHorizontalCandidates(candidates);

    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((line) => line.candidates.map(({ id }) => id))).toEqual([
      ["上左", "上右"],
      ["下左", "下右"],
    ]);
    expect(result.candidates.map(({ id }) => id)).toEqual(["上左", "上右", "下左", "下右"]);
  });

  it("同じ行の小さい候補を分離せず、行内の相対高を保持する", () => {
    const result = orderHorizontalCandidates([
      { id: "つ", x: 8, y: 10, width: 18, height: 20 },
      { id: "小さいや", x: 34, y: 13, width: 13, height: 14 },
      { id: "よ", x: 56, y: 10, width: 18, height: 20 },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].medianHeight).toBe(20);
    expect(result.lines[0].referenceHeight).toBe(20);
    expect(result.lines[0].candidates.map(({ relativeHeight }) => relativeHeight)).toEqual([
      1, 0.7, 1,
    ]);
    expect(isSmallFormCandidate(result.lines[0].candidates[1])).toBe(true);
    expect(isSmallFormCandidate(result.lines[0].candidates[0])).toBe(false);
  });

  it("通常文字1個と小書き1個だけの短い行でも相対サイズを判定する", () => {
    const result = orderHorizontalCandidates([
      { id: "通常", x: 0, y: 0, width: 18, height: 20 },
      { id: "小書き", x: 24, y: 3, width: 13, height: 14 },
    ]);

    expect(result.lines[0].referenceHeight).toBe(20);
    expect(result.lines[0].candidates[1].relativeHeight).toBe(0.7);
    expect(isSmallFormCandidate(result.lines[0].candidates[1])).toBe(true);
  });

  it("中心が離れた候補を隣の行へ混ぜない", () => {
    const result = orderHorizontalCandidates([
      { id: "上", x: 4, y: 0, width: 10, height: 10 },
      { id: "下", x: 4, y: 12, width: 10, height: 10 },
    ]);

    expect(result.lines).toHaveLength(2);
  });

  it("不正な矩形としきい値を拒否する", () => {
    expect(() =>
      orderHorizontalCandidates([{ id: "空", x: 0, y: 0, width: 0, height: 10 }]),
    ).toThrow("幅と高さは0より大きくしてください");
    expect(() => orderHorizontalCandidates([], { lineCenterTolerance: 0 })).toThrow(
      "行の中心許容値は0より大きくしてください",
    );
    expect(() => isSmallFormCandidate({ relativeHeight: 0.7 }, 1)).toThrow(
      "小書き判定のしきい値は0より大きく1未満で指定してください",
    );
  });
});
