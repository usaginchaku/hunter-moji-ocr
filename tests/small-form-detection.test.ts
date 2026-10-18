import { describe, expect, it } from "vitest";
import {
  assessSmallFormInLine,
  assessTemplateSmallForms,
  type TemplateSizeObservation,
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

describe("template-calibrated small forms", () => {
  function observed(
    id: string,
    size: number,
    centerX: number,
    lineIndex = 0,
    supportsSmallForm = true,
    bounds = { x: 8, y: 10, width: 48, height: 44 },
  ): TemplateSizeObservation {
    const scale = size / 64;
    const bottom = 100 + lineIndex * 120;
    return {
      id,
      lineIndex,
      x: centerX - scale * (32 - bounds.x),
      y: bottom - scale * (64 - bounds.y),
      width: bounds.width * scale,
      height: bounds.height * scale,
      template: {
        definition: {
          id,
          kana: "あ",
          direction: "horizontal",
          templatePath: "test-only",
          width: 64,
          height: 64,
          status: "ready",
          supportsDakuten: false,
          supportsHandakuten: false,
          supportsSmallForm,
        },
        sourceBounds: bounds,
        binary: { width: 1, height: 1, pixels: new Uint8Array([1]) },
        features: {
          foregroundRatio: 1,
          aspectRatio: 1,
          projectionX: [1],
          projectionY: [1],
          componentCount: 1,
          spatialGrid: [1],
        },
      },
      score: 0.95,
      margin: 0.2,
      hasModifier: false,
    };
  }

  it("uses full-size drawing scale even when small glyphs are the majority", () => {
    const items = [
      observed("normal", 100, 50),
      ...Array.from({ length: 5 }, (_, index) => observed("small" + index, 70, 150 + index * 100)),
    ];
    const result = assessTemplateSmallForms(items);
    expect(result.get("normal")?.isSmall).toBe(false);
    expect(items.slice(1).every((item) => result.get(item.id)?.isSmall)).toBe(true);
  });

  it("keeps the intrinsically short normal circle normal and recognizes its smaller form", () => {
    const circle = { x: 24, y: 24, width: 16, height: 16 };
    const items = [
      observed("anchor", 100, 50, 0, false),
      observed("normal-i", 100, 150, 0, true, circle),
      observed("small-i", 70, 250, 0, true, circle),
    ];
    const result = assessTemplateSmallForms(items);
    expect(result.get("normal-i")?.isSmall).toBe(false);
    expect(result.get("small-i")?.isSmall).toBe(true);
  });

  it("shares a size with wrapped small-only lines on the same observed cell grid", () => {
    const items = [
      observed("normal1", 100, 50),
      observed("normal2", 100, 150),
      observed("tail1", 70, 50, 1),
      observed("tail2", 70, 150, 1),
      observed("singleton", 70, 50, 2),
    ];
    const result = assessTemplateSmallForms(items);
    expect(result.get("tail1")?.isSmall).toBe(true);
    expect(result.get("tail2")?.isSmall).toBe(true);
    expect(result.get("singleton")?.isSmall).toBe(true);
  });

  it("does not borrow size from a line with a different grid or explicit normal-size anchors", () => {
    const items = [
      observed("normal1", 100, 50),
      observed("normal2", 100, 150),
      observed("other1", 70, 35, 1),
      observed("other2", 70, 105, 1),
      observed("anchor", 70, 50, 2, false),
      observed("normal3", 70, 150, 2),
    ];
    const result = assessTemplateSmallForms(items);
    expect(result.get("other1")?.isSmall).toBe(false);
    expect(result.get("normal3")?.isSmall).toBe(false);
  });

  it("leaves uncertain, distorted, modifier-bearing or superscript observations to the existing path", () => {
    const items = [observed("anchor1", 100, 50), observed("anchor2", 100, 150)];
    const lowScore = { ...observed("uncertain", 70, 250), score: 0.7 };
    const distorted = { ...observed("distorted", 70, 350), width: 95 };
    const modifier = { ...observed("modifier", 70, 450), hasModifier: true };
    const upper = { ...observed("upper", 70, 550), y: 0 };
    const result = assessTemplateSmallForms([...items, lowScore, distorted, modifier, upper]);
    for (const id of ["uncertain", "distorted", "modifier", "upper"])
      expect(result.has(id)).toBe(false);
  });

  it("does not infer absolute small size from an isolated glyph", () => {
    expect(assessTemplateSmallForms([observed("only", 70, 50)]).size).toBe(0);
  });
  it("uses agreeing nearby template dimensions without requiring a confident base margin", () => {
    const anchors = [observed("anchor", 100, 50, 0, false), observed("known-small", 70, 150)];
    const candidate = { ...observed("close", 70, 250), margin: 0.078 };
    const alternative = {
      ...candidate.template!,
      sourceBounds: { x: 8, y: 10, width: 49, height: 45 },
    };
    const result = assessTemplateSmallForms([
      ...anchors,
      { ...candidate, sizeAlternatives: [alternative] },
    ]);
    expect(result.get("close")).toMatchObject({ isSmall: true, ambiguous: true });
  });

  it("rejects close candidates when plausible templates disagree about scale or baseline", () => {
    const anchors = [observed("anchor", 100, 50, 0, false), observed("known-small", 70, 150)];
    const candidate = { ...observed("close", 70, 250), margin: 0.04 };
    const otherSize = {
      ...candidate.template!,
      sourceBounds: { x: 20, y: 10, width: 24, height: 22 },
    };
    const otherBaseline = {
      ...candidate.template!,
      sourceBounds: { x: 8, y: 30, width: 48, height: 34 },
    };
    for (const alternative of [otherSize, otherBaseline]) {
      expect(
        assessTemplateSmallForms([
          ...anchors,
          { ...candidate, sizeAlternatives: [alternative] },
        ]).has("close"),
      ).toBe(false);
    }
  });

  it("does not label a normal-size close candidate small or use an uncertain glyph as an anchor", () => {
    const anchors = [observed("normal", 100, 50), observed("small", 70, 150)];
    const normal = { ...observed("close-normal", 100, 250), margin: 0.04 };
    const large = { ...observed("close-large", 300, 350), margin: 0.04 };
    const result = assessTemplateSmallForms([
      ...anchors,
      { ...normal, sizeAlternatives: [normal.template!] },
      { ...large, sizeAlternatives: [large.template!] },
    ]);
    const previous = assessTemplateSmallForms(anchors);
    expect(result.get("normal")).toEqual(previous.get("normal"));
    expect(result.get("small")).toEqual(previous.get("small"));
    expect(result.has("close-normal")).toBe(false);
    expect(result.has("close-large")).toBe(false);
  });

  it("requires strong references and absolute match quality even when alternative dimensions agree", () => {
    const anchors = [observed("anchor", 100, 50, 0, false), observed("known-small", 70, 150)];
    const candidate = { ...observed("close", 70, 250), margin: 0.04 };
    const close = { ...candidate, sizeAlternatives: [candidate.template!] };
    expect(assessTemplateSmallForms([close]).size).toBe(0);
    expect(
      assessTemplateSmallForms([...anchors, { ...close, sizeAlternatives: [undefined] }]).has(
        "close",
      ),
    ).toBe(false);
    expect(assessTemplateSmallForms([...anchors, { ...close, score: 0.7 }]).has("close")).toBe(
      false,
    );
    expect(
      assessTemplateSmallForms([...anchors, { ...close, hasModifier: true }]).has("close"),
    ).toBe(false);
  });
});
