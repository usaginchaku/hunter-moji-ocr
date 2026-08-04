import type { KanaModifier } from "../domain/kana-composition";

export interface HorizontalPixelBounds {
  left: number;
  right: number;
  sourceWidth: number;
}

export interface GeneratorGlyphLayout {
  drawX: number;
  drawSize: number;
  bodyLeft: number;
  bodyRight: number;
  modifierCenterX: number | null;
  modifierRadius: number;
  modifierOuterRadius: number;
  minimumGap: number;
}

const MODIFIER_RADIUS_RATIO = 0.055;
const MODIFIER_LINE_WIDTH_RATIO = 0.035;
const MODIFIER_PREFERRED_CENTER_RATIO = 0.82;
const MODIFIER_MINIMUM_GAP_RATIO = 0.04;
const CELL_EDGE_PADDING_RATIO = 0.025;

export function findOpaqueHorizontalBounds(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): HorizontalPixelBounds | null {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0)
    throw new Error("字形マスクの幅と高さは正の整数で指定してください。");
  if (rgba.length !== width * height * 4)
    throw new Error("字形マスクの画素数が幅と高さに一致しません。");

  let left = width;
  let right = 0;
  for (let index = 0; index < width * height; index += 1) {
    if ((rgba[index * 4 + 3] ?? 0) === 0) continue;
    const x = index % width;
    left = Math.min(left, x);
    right = Math.max(right, x + 1);
  }
  return right === 0 ? null : { left, right, sourceWidth: width };
}

function assertLayoutInput(
  bounds: HorizontalPixelBounds,
  cellX: number,
  cellSize: number,
  scale: number,
): void {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.right) ||
    !Number.isFinite(bounds.sourceWidth) ||
    bounds.sourceWidth <= 0 ||
    bounds.left < 0 ||
    bounds.right <= bounds.left ||
    bounds.right > bounds.sourceWidth
  )
    throw new Error("字形本体の横方向境界が不正です。");
  if (!Number.isFinite(cellX) || !Number.isFinite(cellSize) || cellSize <= 0)
    throw new Error("文字セルの位置と大きさが不正です。");
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1)
    throw new Error("字形の倍率は0より大きく1以下で指定してください。");
}

export function computeGeneratorGlyphLayout(
  bounds: HorizontalPixelBounds,
  cellX: number,
  cellSize: number,
  scale: number,
  modifier: KanaModifier | null,
): GeneratorGlyphLayout {
  assertLayoutInput(bounds, cellX, cellSize, scale);

  let drawSize = cellSize * scale;
  let sourcePixelScale = drawSize / bounds.sourceWidth;
  const defaultDrawX = cellX + (cellSize - drawSize) / 2;
  let drawX = defaultDrawX;
  const modifierRadius = cellSize * MODIFIER_RADIUS_RATIO;
  const minimumGap = cellSize * MODIFIER_MINIMUM_GAP_RATIO;

  if (!modifier) {
    return {
      drawX,
      drawSize,
      bodyLeft: drawX + bounds.left * sourcePixelScale,
      bodyRight: drawX + bounds.right * sourcePixelScale,
      modifierCenterX: null,
      modifierRadius,
      modifierOuterRadius: modifierRadius,
      minimumGap,
    };
  }

  const modifierLineWidth = Math.max(2, cellSize * MODIFIER_LINE_WIDTH_RATIO);
  const modifierOuterRadius =
    modifier === "handakuten" ? modifierRadius + modifierLineWidth / 2 : modifierRadius;
  const edgePadding = cellSize * CELL_EDGE_PADDING_RATIO;
  const maximumModifierCenter = cellX + cellSize - edgePadding - modifierOuterRadius;
  const maximumBodyRight = maximumModifierCenter - modifierOuterRadius - minimumGap;
  const minimumBodyLeft = cellX + edgePadding;

  let minimumDrawX = minimumBodyLeft - bounds.left * sourcePixelScale;
  let maximumDrawX = maximumBodyRight - bounds.right * sourcePixelScale;
  if (minimumDrawX > maximumDrawX) {
    sourcePixelScale = Math.min(
      sourcePixelScale,
      (maximumBodyRight - minimumBodyLeft) / (bounds.right - bounds.left),
    );
    drawSize = sourcePixelScale * bounds.sourceWidth;
    minimumDrawX = minimumBodyLeft - bounds.left * sourcePixelScale;
    maximumDrawX = maximumBodyRight - bounds.right * sourcePixelScale;
  }
  drawX = Math.min(Math.max(defaultDrawX, minimumDrawX), maximumDrawX);

  const bodyLeft = drawX + bounds.left * sourcePixelScale;
  const bodyRight = drawX + bounds.right * sourcePixelScale;
  const preferredModifierCenter = cellX + cellSize * MODIFIER_PREFERRED_CENTER_RATIO;
  const modifierCenterX = Math.min(
    maximumModifierCenter,
    Math.max(preferredModifierCenter, bodyRight + minimumGap + modifierOuterRadius),
  );

  return {
    drawX,
    drawSize,
    bodyLeft,
    bodyRight,
    modifierCenterX,
    modifierRadius,
    modifierOuterRadius,
    minimumGap,
  };
}
