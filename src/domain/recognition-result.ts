import type { KanaModifier } from "./kana-composition";
import { composeKana } from "./kana-composition";
import { composeSmallKana } from "./small-kana";

export type GlyphSize = "normal" | "small";
export type GlyphSizeSelection = "auto" | GlyphSize;
export type GlyphModifierSelection = "auto" | "none" | KanaModifier;
export type GlyphBaseSelection = "auto" | "manual";

export interface RecognitionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognizedGlyphCandidate {
  templateId: string;
  kana: string;
  score: number;
}

export interface ModifierAssociationReference {
  baseSourceId: string;
  markSourceId: string;
}

export interface RecognizedGlyphResult {
  id: string;
  lineIndex: number;
  bbox: RecognitionBoundingBox;
  candidates: readonly RecognizedGlyphCandidate[];
  automaticBaseKana: string;
  selectedBaseKana: string;
  baseSelection: GlyphBaseSelection;
  automaticSize: GlyphSize;
  automaticSizeAmbiguous: boolean;
  sizeSelection: GlyphSizeSelection;
  detectedModifier: KanaModifier | null;
  modifierConfidence: number;
  modifierSelection: GlyphModifierSelection;
  modifierAssociation: ModifierAssociationReference | null;
}

export interface ResolvedGlyphOutput {
  baseKana: string;
  kana: string;
  size: GlyphSize;
  sizeApplied: boolean;
  sizeSupported: boolean;
  modifierApplied: KanaModifier | null;
}

export function resolveGlyphSize(
  selection: GlyphSizeSelection,
  automaticSize: GlyphSize,
): GlyphSize {
  return selection === "auto" ? automaticSize : selection;
}

export function resolveGlyphModifier(
  selection: GlyphModifierSelection,
  detectedModifier: KanaModifier | null,
  modifierConfidence: number,
  automaticThreshold = 0.7,
): KanaModifier | null {
  if (!Number.isFinite(modifierConfidence) || modifierConfidence < 0 || modifierConfidence > 1)
    throw new Error("修飾記号の信頼度は0以上1以下で指定してください。");
  if (!Number.isFinite(automaticThreshold) || automaticThreshold < 0 || automaticThreshold > 1)
    throw new Error("修飾記号の自動確定しきい値は0以上1以下で指定してください。");
  if (selection === "none") return null;
  if (selection !== "auto") return selection;
  return detectedModifier && modifierConfidence >= automaticThreshold ? detectedModifier : null;
}

export function resolveGlyphOutput(
  baseKana: string,
  sizeSelection: GlyphSizeSelection,
  automaticSize: GlyphSize,
  modifier: KanaModifier | null,
): ResolvedGlyphOutput {
  if (modifier) {
    const composition = composeKana(baseKana, modifier);
    if (composition.ok) {
      return {
        baseKana,
        kana: composition.kana,
        size: "normal",
        sizeApplied: false,
        sizeSupported: false,
        modifierApplied: modifier,
      };
    }
  }

  const size = resolveGlyphSize(sizeSelection, automaticSize);
  if (size === "small") {
    const composition = composeSmallKana(baseKana);
    if (composition.ok) {
      return {
        baseKana,
        kana: composition.kana,
        size,
        sizeApplied: true,
        sizeSupported: true,
        modifierApplied: null,
      };
    }
    return {
      baseKana,
      kana: baseKana,
      size,
      sizeApplied: false,
      sizeSupported: false,
      modifierApplied: null,
    };
  }

  return {
    baseKana,
    kana: baseKana,
    size,
    sizeApplied: false,
    sizeSupported: true,
    modifierApplied: null,
  };
}
