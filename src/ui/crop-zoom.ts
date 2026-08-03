export interface PreviewSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function clampCropZoom(zoom: number, minimum = 1, maximum = 4): number {
  if (!Number.isFinite(zoom)) throw new Error("表示倍率は有限の数値で指定してください。");
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum < minimum)
    throw new Error("表示倍率の範囲が不正です。");
  return Math.min(maximum, Math.max(minimum, zoom));
}

export function fitCropPreviewSize(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth: number,
  maximumHeight = 420,
): PreviewSize {
  const values = [naturalWidth, naturalHeight, availableWidth, maximumHeight];
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("プレビューの寸法は0より大きい有限値で指定してください。");

  const scale = Math.min(1, availableWidth / naturalWidth, maximumHeight / naturalHeight);
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function calculatePannedScroll(
  startingScroll: Point,
  startingPointer: Point,
  currentPointer: Point,
): Point {
  return {
    x: Math.max(0, startingScroll.x - (currentPointer.x - startingPointer.x)),
    y: Math.max(0, startingScroll.y - (currentPointer.y - startingPointer.y)),
  };
}

export function cropZoomFromWheel(currentZoom: number, deltaY: number, step = 0.25): number {
  if (!Number.isFinite(deltaY) || !Number.isFinite(step) || step <= 0)
    throw new Error("ホイール操作と倍率刻みは有効な数値で指定してください。");
  if (deltaY === 0) return currentZoom;
  return currentZoom + (deltaY < 0 ? step : -step);
}
