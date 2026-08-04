import { describe, expect, it } from "vitest";
import { buildGlyphSizeChoices, coerceGlyphSizeSelection } from "../src/ui/glyph-size-control";

describe("glyph size control", () => {
  it("自動判定の内容を選択肢ラベルへ表示する", () => {
    const choices = buildGlyphSizeChoices("つ", "small");
    expect(choices[0]).toMatchObject({
      value: "auto",
      label: "自動（小書き）",
      selected: true,
    });
  });

  it("対応字形では通常と小書きをどちらも選べる", () => {
    const choices = buildGlyphSizeChoices("や", "normal", "small");
    expect(choices.find(({ value }) => value === "normal")?.disabled).toBe(false);
    expect(choices.find(({ value }) => value === "small")).toMatchObject({
      selected: true,
      disabled: false,
    });
  });

  it("母音も手動で小書きへ変更できる", () => {
    const choices = buildGlyphSizeChoices("い", "normal", "small");
    expect(choices.find(({ value }) => value === "small")).toMatchObject({
      selected: true,
      disabled: false,
    });
    expect(coerceGlyphSizeSelection("い", "small")).toBe("small");
  });

  it("非対応字形では小書きを無効化して自動へ戻す", () => {
    const choices = buildGlyphSizeChoices("か", "small", "small");
    expect(choices.find(({ value }) => value === "auto")?.selected).toBe(true);
    expect(choices.find(({ value }) => value === "small")).toMatchObject({
      selected: false,
      disabled: true,
    });
    expect(coerceGlyphSizeSelection("か", "small")).toBe("auto");
  });
});
