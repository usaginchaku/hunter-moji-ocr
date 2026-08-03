import type { BinaryGlyph } from "../recognition/features";

export function drawBinaryGlyph(canvas: HTMLCanvasElement, glyph: BinaryGlyph, scale = 3): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2Dを初期化できませんでした。");

  canvas.width = glyph.width * scale;
  canvas.height = glyph.height * scale;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#17221c";

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      if (glyph.pixels[y * glyph.width + x] !== 0) {
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}
