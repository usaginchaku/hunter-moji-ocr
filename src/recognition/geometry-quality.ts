export interface RecognitionBox {
  width: number;
  height: number;
}

export interface GeometryQuality {
  tinyFragments: number;
  skinnyFragments: number;
  penalty: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function evaluateRecognitionGeometry(boxes: readonly RecognitionBox[]): GeometryQuality {
  if (boxes.length === 0) return { tinyFragments: 0, skinnyFragments: 0, penalty: 0 };
  if (
    boxes.some(
      ({ width, height }) =>
        !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0,
    )
  )
    throw new Error("文字候補の寸法が不正です。");

  const referenceHeight = median(boxes.map(({ height }) => height));
  let tinyFragments = 0;
  let skinnyFragments = 0;
  for (const box of boxes) {
    if (box.height < referenceHeight * 0.6 && box.width < referenceHeight * 0.65) {
      tinyFragments += 1;
    } else if (box.height >= referenceHeight * 0.65 && box.width / box.height < 0.22) {
      skinnyFragments += 1;
    }
  }
  return {
    tinyFragments,
    skinnyFragments,
    penalty: tinyFragments * 0.075 + skinnyFragments * 0.08,
  };
}
