import { describe, expect, it } from "vitest";
import {
  buildGlyphModifierChoices,
  coerceGlyphModifierSelection,
} from "../src/ui/glyph-modifier-control";

describe("glyph modifier control", () => {
  it("確信度が足りる自動検出を選択肢ラベルへ表示する", () => {
    expect(buildGlyphModifierChoices("か", "dakuten", 0.82)[0]).toMatchObject({
      value: "auto",
      label: "自動（濁点）",
      selected: true,
    });
  });

  it("低信頼または非対応の自動検出はなしとして表示する", () => {
    expect(buildGlyphModifierChoices("か", "dakuten", 0.5)[0].label).toBe("自動（なし）");
    expect(buildGlyphModifierChoices("あ", "dakuten", 0.9)[0].label).toBe("自動（なし）");
  });

  it("は行では濁点と半濁点を選べる", () => {
    const choices = buildGlyphModifierChoices("は", null, 0, "handakuten");
    expect(choices.find(({ value }) => value === "dakuten")?.disabled).toBe(false);
    expect(choices.find(({ value }) => value === "handakuten")).toMatchObject({
      selected: true,
      disabled: false,
    });
  });

  it("未対応の明示指定は自動へ戻して選択肢を無効化する", () => {
    const choices = buildGlyphModifierChoices("あ", null, 0, "dakuten");
    expect(choices.find(({ value }) => value === "auto")?.selected).toBe(true);
    expect(choices.find(({ value }) => value === "dakuten")?.disabled).toBe(true);
    expect(coerceGlyphModifierSelection("あ", "dakuten")).toBe("auto");
  });
});
