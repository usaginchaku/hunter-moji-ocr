import { describe, expect, it } from "vitest";
import {
  createGeneratorTextPlan,
  limitGeneratorSourceText,
  MAX_GENERATOR_SOURCE_CHARACTERS,
} from "../src/generator/text-plan";

describe("createGeneratorTextPlan", () => {
  it("基本字・濁点・半濁点・小書きを描画情報へ変換する", () => {
    const plan = createGeneratorTextPlan("かがぱぁぃぅぇぉっゃゅょ", 16);
    const glyphs = plan.lines[0].filter((token) => token.kind === "glyph");

    expect(glyphs.map(({ glyph }) => glyph.kana)).toEqual([
      "か",
      "か",
      "は",
      "あ",
      "い",
      "う",
      "え",
      "お",
      "つ",
      "や",
      "ゆ",
      "よ",
    ]);
    expect(glyphs.map(({ modifier }) => modifier)).toEqual([
      null,
      "dakuten",
      "handakuten",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(glyphs.map(({ small }) => small)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("明示改行と指定文字数による折り返しを保持する", () => {
    const plan = createGeneratorTextPlan("あいうえお\nかき", 3);
    expect(plan.lines.map((line) => line.map(({ source }) => source).join(""))).toEqual([
      "あいう",
      "えお",
      "かき",
    ]);
  });

  it("空行・空白・未対応文字を失わず報告する", () => {
    const plan = createGeneratorTextPlan("あ A\n\nい！", 10);
    expect(plan.lines).toHaveLength(3);
    expect(plan.lines[0].map(({ kind }) => kind)).toEqual(["glyph", "space", "unsupported"]);
    expect(plan.lines[1]).toEqual([]);
    expect(plan.unsupported).toEqual(["A", "！"]);
    expect(plan.sourceCharacterCount).toBe(5);
  });

  it("不正な折り返し数を拒否する", () => {
    expect(() => createGeneratorTextPlan("あ", 0)).toThrow(
      "1行の文字数は1以上の整数で指定してください。",
    );
  });

  it("HTMLやJavaScript風の入力を未対応文字として扱う", () => {
    const input = `<img onerror="alert('x')">&<script>A</script>`;
    const plan = createGeneratorTextPlan(input, 10);

    expect(plan.lines.flat().every(({ kind }) => kind !== "glyph")).toBe(true);
    expect(plan.unsupported).toContain("<");
    expect(plan.unsupported).toContain("&");
    expect(plan.unsupported).toContain('"');
  });

  it("入力をUnicode文字単位で200文字に制限する", () => {
    const input = `${"あ".repeat(MAX_GENERATOR_SOURCE_CHARACTERS)}😀追加`;
    const limited = limitGeneratorSourceText(input);
    const plan = createGeneratorTextPlan(input, 10);

    expect([...limited]).toHaveLength(MAX_GENERATOR_SOURCE_CHARACTERS);
    expect([...plan.lines.flat()]).toHaveLength(MAX_GENERATOR_SOURCE_CHARACTERS);
    expect(plan.sourceCharacterCount).toBe(MAX_GENERATOR_SOURCE_CHARACTERS);
  });
});
