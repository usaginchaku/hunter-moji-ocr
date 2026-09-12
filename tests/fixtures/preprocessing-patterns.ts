import {
  rgbaToAdaptiveBinaryGlyph,
  rgbaToDarkInkBinaryGlyph,
  rgbaToLocalColorContrastBinaryGlyph,
  rgbaToLocalContrastBinaryGlyph,
  rgbaToNeutralInkBinaryGlyph,
  rgbaToSauvolaBinaryGlyph,
  type BinaryGlyphVariant,
} from "../../src/image/load";

export const PREPROCESSING_PATTERNS = [
  { id: "white-black", background: "#ffffff", ink: "#000000" },
  { id: "black-white", background: "#000000", ink: "#ffffff" },
  { id: "gray-black", background: "#999999", ink: "#222222" },
  { id: "gray-white", background: "#777777", ink: "#eeeeee" },
  { id: "low-contrast-dark", background: "#bbbbbb", ink: "#a3a3a3" },
  { id: "low-contrast-light", background: "#444444", ink: "#5c5c5c" },
  { id: "navy-yellow", background: "#01007f", ink: "#ffff18" },
  { id: "pale-orange", background: "#f5f8f2", ink: "#ff6600" },
] as const;

/** The six original branches, without polarity/contrast normalization: comparison baseline. */
export function originalBinarizationVariants(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): BinaryGlyphVariant[] {
  return [
    {
      mode: "background",
      label: "背景色との差",
      binary: rgbaToAdaptiveBinaryGlyph(rgba, width, height),
    },
    {
      mode: "dark-ink",
      label: "黒い線を優先",
      binary: rgbaToDarkInkBinaryGlyph(rgba, width, height),
    },
    {
      mode: "local-contrast",
      label: "局所コントラスト",
      binary: rgbaToLocalContrastBinaryGlyph(rgba, width, height),
    },
    {
      mode: "local-color",
      label: "局所色差",
      binary: rgbaToLocalColorContrastBinaryGlyph(rgba, width, height),
    },
    {
      mode: "sauvola",
      label: "局所分散（Sauvola）",
      binary: rgbaToSauvolaBinaryGlyph(rgba, width, height),
    },
    {
      mode: "neutral-ink",
      label: "無彩色の黒線",
      binary: rgbaToNeutralInkBinaryGlyph(rgba, width, height),
    },
  ];
}
