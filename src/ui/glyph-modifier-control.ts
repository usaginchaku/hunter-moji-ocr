import { getSupportedModifiers, type KanaModifier } from "../domain/kana-composition";
import { resolveGlyphModifier, type GlyphModifierSelection } from "../domain/recognition-result";

export interface GlyphModifierChoice {
  value: GlyphModifierSelection;
  label: string;
  selected: boolean;
  disabled: boolean;
}

const MODIFIER_LABELS: Readonly<Record<KanaModifier, string>> = {
  dakuten: "濁点",
  handakuten: "半濁点",
};

export function coerceGlyphModifierSelection(
  baseKana: string,
  selection: GlyphModifierSelection,
): GlyphModifierSelection {
  if (selection === "auto" || selection === "none") return selection;
  return getSupportedModifiers(baseKana).includes(selection) ? selection : "auto";
}

export function buildGlyphModifierChoices(
  baseKana: string,
  detectedModifier: KanaModifier | null,
  modifierConfidence: number,
  selection: GlyphModifierSelection = "auto",
  automaticThreshold = 0.7,
): GlyphModifierChoice[] {
  const supported = getSupportedModifiers(baseKana);
  const safeSelection = coerceGlyphModifierSelection(baseKana, selection);
  const automaticModifier = resolveGlyphModifier(
    "auto",
    detectedModifier && supported.includes(detectedModifier) ? detectedModifier : null,
    modifierConfidence,
    automaticThreshold,
  );
  return [
    {
      value: "auto",
      label: `自動（${automaticModifier ? MODIFIER_LABELS[automaticModifier] : "なし"}）`,
      selected: safeSelection === "auto",
      disabled: false,
    },
    {
      value: "none",
      label: "なし",
      selected: safeSelection === "none",
      disabled: false,
    },
    {
      value: "dakuten",
      label: "濁点",
      selected: safeSelection === "dakuten",
      disabled: !supported.includes("dakuten"),
    },
    {
      value: "handakuten",
      label: "半濁点",
      selected: safeSelection === "handakuten",
      disabled: !supported.includes("handakuten"),
    },
  ];
}
