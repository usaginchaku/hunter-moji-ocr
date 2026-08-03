import {
  resolveGlyphSize,
  type GlyphSize,
  type GlyphSizeSelection,
} from "../domain/recognition-result";
import { composeSmallKana } from "../domain/small-kana";

export interface GlyphSizeChoice {
  value: GlyphSizeSelection;
  label: string;
  selected: boolean;
  disabled: boolean;
}

export function buildGlyphSizeChoices(
  baseKana: string,
  automaticSize: GlyphSize,
  selection: GlyphSizeSelection = "auto",
): GlyphSizeChoice[] {
  const smallSupported = composeSmallKana(baseKana).ok;
  const safeSelection = selection === "small" && !smallSupported ? "auto" : selection;
  const resolvedAutomaticSize = resolveGlyphSize("auto", automaticSize);
  return [
    {
      value: "auto",
      label: `自動（${resolvedAutomaticSize === "small" && smallSupported ? "小書き" : "通常"}）`,
      selected: safeSelection === "auto",
      disabled: false,
    },
    {
      value: "normal",
      label: "通常",
      selected: safeSelection === "normal",
      disabled: false,
    },
    {
      value: "small",
      label: "小書き",
      selected: safeSelection === "small",
      disabled: !smallSupported,
    },
  ];
}

export function coerceGlyphSizeSelection(
  baseKana: string,
  selection: GlyphSizeSelection,
): GlyphSizeSelection {
  return selection === "small" && !composeSmallKana(baseKana).ok ? "auto" : selection;
}
