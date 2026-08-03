export type SmallKanaCompositionResult =
  | { ok: true; baseKana: string; kana: string }
  | { ok: false; baseKana: string; reason: "unsupported-base" };

const SMALL_KANA_COMPOSITIONS: Readonly<Record<string, string>> = {
  つ: "っ",
  や: "ゃ",
  ゆ: "ゅ",
  よ: "ょ",
};

export const SMALL_KANA_BASES = Object.freeze(Object.keys(SMALL_KANA_COMPOSITIONS));

export function composeSmallKana(baseKana: string): SmallKanaCompositionResult {
  const kana = SMALL_KANA_COMPOSITIONS[baseKana];
  if (!kana) return { ok: false, baseKana, reason: "unsupported-base" };
  return { ok: true, baseKana, kana };
}
