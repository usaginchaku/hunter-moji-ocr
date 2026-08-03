export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_IMAGE_SIDE = 32_768;

export type ImageValidationResult = { ok: true } | { ok: false; message: string };

export function validateImageDimensions(
  width: number,
  height: number,
  maxPixels = MAX_IMAGE_PIXELS,
  maxSide = MAX_IMAGE_SIDE,
): ImageValidationResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return { ok: false, message: "画像の縦横サイズが不正です。" };
  if (width > maxSide || height > maxSide || width * height > maxPixels)
    return {
      ok: false,
      message: `画像の縦横または総画素数が上限を超えています（最大辺${maxSide}px・最大${maxPixels.toLocaleString()}画素）。`,
    };
  return { ok: true };
}

export function validateImageFile(
  file: Pick<File, "size" | "type">,
  maxBytes = MAX_IMAGE_BYTES,
): ImageValidationResult {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, message: "PNG、JPEG、WebPの画像を選択してください。" };
  }

  if (file.size === 0) {
    return { ok: false, message: "空の画像ファイルは読み込めません。" };
  }

  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `画像サイズが上限の${formatFileSize(maxBytes)}を超えています。`,
    };
  }

  return { ok: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
