export type KanaModifier = "dakuten" | "handakuten";

export type KanaCompositionResult =
  | {
      ok: true;
      baseKana: string;
      modifier: KanaModifier;
      kana: string;
    }
  | {
      ok: false;
      baseKana: string;
      modifier: KanaModifier;
      reason: "unsupported-combination";
    };

export const KANA_MODIFIER_LABELS: Readonly<Record<KanaModifier, string>> = {
  dakuten: "濁点",
  handakuten: "半濁点",
};

const DAKUTEN_COMPOSITIONS: Readonly<Record<string, string>> = {
  か: "が",
  き: "ぎ",
  く: "ぐ",
  け: "げ",
  こ: "ご",
  さ: "ざ",
  し: "じ",
  す: "ず",
  せ: "ぜ",
  そ: "ぞ",
  た: "だ",
  ち: "ぢ",
  つ: "づ",
  て: "で",
  と: "ど",
  は: "ば",
  ひ: "び",
  ふ: "ぶ",
  へ: "べ",
  ほ: "ぼ",
};

const HANDAKUTEN_COMPOSITIONS: Readonly<Record<string, string>> = {
  は: "ぱ",
  ひ: "ぴ",
  ふ: "ぷ",
  へ: "ぺ",
  ほ: "ぽ",
};

const COMPOSITIONS: Readonly<Record<KanaModifier, Readonly<Record<string, string>>>> = {
  dakuten: DAKUTEN_COMPOSITIONS,
  handakuten: HANDAKUTEN_COMPOSITIONS,
};

export function composeKana(baseKana: string, modifier: KanaModifier): KanaCompositionResult {
  const kana = COMPOSITIONS[modifier][baseKana];
  if (!kana) {
    return { ok: false, baseKana, modifier, reason: "unsupported-combination" };
  }
  return { ok: true, baseKana, modifier, kana };
}

export function getSupportedModifiers(baseKana: string): KanaModifier[] {
  return (["dakuten", "handakuten"] as const).filter(
    (modifier) => COMPOSITIONS[modifier][baseKana] !== undefined,
  );
}
