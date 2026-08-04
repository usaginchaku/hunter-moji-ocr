import "./generator.css";
import { resolvePublicAsset } from "./glyphs/assets";
import type { KanaModifier } from "./domain/kana-composition";
import {
  createGeneratorTextPlan,
  limitGeneratorSourceText,
  MAX_GENERATOR_SOURCE_CHARACTERS,
  type GeneratorToken,
} from "./generator/text-plan";
import { computeGeneratorGlyphLayout, findOpaqueHorizontalBounds } from "./generator/glyph-layout";

interface RenderSettings {
  cellSize: number;
  gap: number;
  padding: number;
  maxColumns: number;
  inkColor: string;
  backgroundColor: string;
  transparent: boolean;
}

const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_PIXELS = 16_777_216;
const BLOB_URL_REVOKE_DELAY_MS = 1_000;

const app = document.querySelector<HTMLDivElement>("#generator-app");
if (!app) throw new Error("画像メーカーの表示領域が見つかりません。");

app.innerHTML = `
  <main class="maker-shell">
    <header class="maker-hero">
      <div>
        <p class="maker-eyebrow">HUNTER MOJI MAKER <span class="maker-beta">BETA</span></p>
        <h1>ハンター文字 <span>画像メーカー</span></h1>
        <p>ひらがなを入力して、独自作図のハンター文字画像を作成します。</p>
      </div>
      <a class="maker-nav" href="${import.meta.env.BASE_URL}">画像を読み取る OCRへ</a>
    </header>

    <section class="maker-note" aria-label="このツールについて">
      <strong>BETA・試験公開中</strong>
      <span>すべてブラウザ内で処理し、入力内容や生成画像を外部サーバーへ送信しません。</span>
    </section>

    <section class="maker-workspace">
      <div class="maker-controls">
        <label class="maker-text-label" for="source-text">
          <span>ひらがな</span>
          <textarea id="source-text" maxlength="${MAX_GENERATOR_SOURCE_CHARACTERS}" rows="6">おはよう
ありがとう</textarea>
        </label>
        <p class="maker-help">濁点・半濁点・「ぁ・ぃ・ぅ・ぇ・ぉ・っ・ゃ・ゅ・ょ」・長音・空白・改行に対応します。</p>

        <div class="maker-options">
          <label>文字色 <input id="ink-color" type="color" value="#111111" /></label>
          <label>背景色 <input id="background-color" type="color" value="#ffffff" /></label>
          <label class="maker-check"><input id="transparent-background" type="checkbox" /> 背景を透明にする</label>
          <label>文字サイズ <input id="cell-size" type="range" min="48" max="144" step="8" value="96" /><output id="cell-size-value">96px</output></label>
          <label>文字間隔 <input id="glyph-gap" type="range" min="0" max="32" step="2" value="8" /><output id="glyph-gap-value">8px</output></label>
          <label>余白 <input id="canvas-padding" type="range" min="0" max="64" step="4" value="32" /><output id="canvas-padding-value">32px</output></label>
          <label>1行の文字数 <input id="max-columns" type="range" min="4" max="16" step="1" value="10" /><output id="max-columns-value">10文字</output></label>
        </div>

        <div class="maker-presets" aria-label="配色プリセット">
          <button type="button" data-ink="#111111" data-background="#ffffff">白地に黒</button>
          <button type="button" data-ink="#ffffff" data-background="#111111">白黒反転</button>
          <button type="button" data-ink="#123c69" data-background="#f5d76e">青と黄</button>
          <button type="button" data-ink="#7b1e3a" data-background="#dff3e4">赤と緑</button>
        </div>
      </div>

      <section class="maker-preview-panel" aria-labelledby="preview-heading">
        <div class="maker-preview-heading">
          <div><p>PREVIEW</p><h2 id="preview-heading">生成画像</h2></div>
          <button id="download-png" type="button">PNGで保存</button>
        </div>
        <div class="maker-canvas-frame">
          <canvas id="generated-canvas" aria-label="生成したハンター文字画像"></canvas>
        </div>
        <p id="generator-status" role="status">字形を準備しています。</p>
      </section>
    </section>

    <footer>
      <p>非公式ファンツールです。作品および権利者とは関係ありません。</p>
      <p>公開素材は独自作図のSVGだけを使用しています。</p>
    </footer>
  </main>
`;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`必要な要素が見つかりません: ${selector}`);
  return element;
}

const sourceText = required<HTMLTextAreaElement>("#source-text");
const inkColor = required<HTMLInputElement>("#ink-color");
const backgroundColor = required<HTMLInputElement>("#background-color");
const transparentBackground = required<HTMLInputElement>("#transparent-background");
const cellSize = required<HTMLInputElement>("#cell-size");
const glyphGap = required<HTMLInputElement>("#glyph-gap");
const canvasPadding = required<HTMLInputElement>("#canvas-padding");
const maxColumns = required<HTMLInputElement>("#max-columns");
const cellSizeValue = required<HTMLOutputElement>("#cell-size-value");
const glyphGapValue = required<HTMLOutputElement>("#glyph-gap-value");
const canvasPaddingValue = required<HTMLOutputElement>("#canvas-padding-value");
const maxColumnsValue = required<HTMLOutputElement>("#max-columns-value");
const canvas = required<HTMLCanvasElement>("#generated-canvas");
const status = required<HTMLParagraphElement>("#generator-status");
const downloadButton = required<HTMLButtonElement>("#download-png");

const imageCache = new Map<string, Promise<HTMLImageElement>>();
let renderRequest = 0;

function loadGlyphImage(templatePath: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(templatePath);
  if (cached) return cached;

  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`字形を読み込めませんでした: ${templatePath}`)),
      { once: true },
    );
    image.src = resolvePublicAsset(templatePath);
  });
  imageCache.set(templatePath, request);
  return request;
}

function readSettings(): RenderSettings {
  return {
    cellSize: Number(cellSize.value),
    gap: Number(glyphGap.value),
    padding: Number(canvasPadding.value),
    maxColumns: Number(maxColumns.value),
    inkColor: inkColor.value,
    backgroundColor: backgroundColor.value,
    transparent: transparentBackground.checked,
  };
}

function updateControlLabels(settings: RenderSettings): void {
  cellSizeValue.value = `${settings.cellSize}px`;
  glyphGapValue.value = `${settings.gap}px`;
  canvasPaddingValue.value = `${settings.padding}px`;
  maxColumnsValue.value = `${settings.maxColumns}文字`;
  backgroundColor.disabled = settings.transparent;
}

function drawModifier(
  context: CanvasRenderingContext2D,
  modifier: KanaModifier,
  centerX: number,
  y: number,
  cell: number,
  radius: number,
  color: string,
): void {
  const centerY = y + cell * 0.78;
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  if (modifier === "dakuten") {
    context.fillStyle = color;
    context.fill();
  } else {
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, cell * 0.035);
    context.stroke();
  }
  context.restore();
}

function drawUnsupported(
  context: CanvasRenderingContext2D,
  token: Extract<GeneratorToken, { kind: "unsupported" }>,
  x: number,
  y: number,
  cell: number,
  color: string,
): void {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.45;
  context.setLineDash([5, 5]);
  context.strokeRect(x + cell * 0.16, y + cell * 0.16, cell * 0.68, cell * 0.68);
  context.setLineDash([]);
  context.globalAlpha = 0.7;
  context.fillStyle = color;
  context.font = `${Math.round(cell * 0.24)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(token.source, x + cell / 2, y + cell / 2);
  context.restore();
}

async function drawGlyph(
  context: CanvasRenderingContext2D,
  token: Extract<GeneratorToken, { kind: "glyph" }>,
  x: number,
  y: number,
  cell: number,
  color: string,
): Promise<void> {
  const image = await loadGlyphImage(token.glyph.templatePath);
  const mask = document.createElement("canvas");
  mask.width = 64;
  mask.height = 64;
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("字形の描画領域を初期化できませんでした。");
  maskContext.drawImage(image, 0, 0, 64, 64);
  const bodyBounds = token.modifier
    ? (findOpaqueHorizontalBounds(maskContext.getImageData(0, 0, 64, 64).data, 64, 64) ?? {
        left: 0,
        right: 64,
        sourceWidth: 64,
      })
    : { left: 0, right: 64, sourceWidth: 64 };
  maskContext.globalCompositeOperation = "source-in";
  maskContext.fillStyle = color;
  maskContext.fillRect(0, 0, 64, 64);

  const scale = token.small ? 0.7 : 1;
  const layout = computeGeneratorGlyphLayout(bodyBounds, x, cell, scale, token.modifier);
  const drawY = y + cell - layout.drawSize;
  context.drawImage(mask, layout.drawX, drawY, layout.drawSize, layout.drawSize);
  if (token.modifier && layout.modifierCenterX !== null)
    drawModifier(
      context,
      token.modifier,
      layout.modifierCenterX,
      y,
      cell,
      layout.modifierRadius,
      color,
    );
}

async function render(): Promise<void> {
  const request = ++renderRequest;
  const settings = readSettings();
  updateControlLabels(settings);
  const plan = createGeneratorTextPlan(sourceText.value, settings.maxColumns);
  const lineCount = Math.max(1, plan.lines.length);
  const widestLine = Math.max(1, ...plan.lines.map((line) => line.length));
  const width =
    settings.padding * 2 + widestLine * settings.cellSize + (widestLine - 1) * settings.gap;
  const height =
    settings.padding * 2 + lineCount * settings.cellSize + (lineCount - 1) * settings.gap;

  if (
    width > MAX_CANVAS_DIMENSION ||
    height > MAX_CANVAS_DIMENSION ||
    width * height > MAX_CANVAS_PIXELS
  ) {
    status.textContent = "画像が大きすぎます。文字サイズ・余白・改行数を減らしてください。";
    status.dataset.state = "error";
    downloadButton.disabled = true;
    return;
  }

  const renderedCanvas = document.createElement("canvas");
  renderedCanvas.width = width;
  renderedCanvas.height = height;
  const context = renderedCanvas.getContext("2d");
  if (!context) throw new Error("Canvas 2Dを初期化できませんでした。");
  context.clearRect(0, 0, width, height);
  if (!settings.transparent) {
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  status.textContent = "字形を描画しています。";
  status.dataset.state = "loading";

  const jobs: Promise<void>[] = [];
  for (const [lineIndex, line] of plan.lines.entries()) {
    for (const [columnIndex, token] of line.entries()) {
      const x = settings.padding + columnIndex * (settings.cellSize + settings.gap);
      const y = settings.padding + lineIndex * (settings.cellSize + settings.gap);
      if (token.kind === "glyph") {
        jobs.push(drawGlyph(context, token, x, y, settings.cellSize, settings.inkColor));
      } else if (token.kind === "unsupported") {
        drawUnsupported(context, token, x, y, settings.cellSize, settings.inkColor);
      }
    }
  }

  try {
    await Promise.all(jobs);
    if (request !== renderRequest) return;
    canvas.width = width;
    canvas.height = height;
    const visibleContext = canvas.getContext("2d");
    if (!visibleContext) throw new Error("Canvas 2Dを初期化できませんでした。");
    visibleContext.drawImage(renderedCanvas, 0, 0);
    const unsupportedMessage = plan.unsupported.length
      ? ` 未対応: ${plan.unsupported.join("・")}`
      : "";
    status.textContent = `${plan.sourceCharacterCount}文字 · ${width}×${height}pxで生成しました。${unsupportedMessage}`;
    status.dataset.state = plan.unsupported.length ? "warning" : "success";
    downloadButton.disabled = plan.sourceCharacterCount === 0;
  } catch (error) {
    if (request !== renderRequest) return;
    status.textContent = error instanceof Error ? error.message : "画像を生成できませんでした。";
    status.dataset.state = "error";
    downloadButton.disabled = true;
  }
}

let scheduledRender = 0;
function scheduleRender(): void {
  const limitedSource = limitGeneratorSourceText(sourceText.value);
  if (limitedSource !== sourceText.value) sourceText.value = limitedSource;
  window.clearTimeout(scheduledRender);
  scheduledRender = window.setTimeout(() => void render(), 80);
}

for (const control of [
  sourceText,
  inkColor,
  backgroundColor,
  transparentBackground,
  cellSize,
  glyphGap,
  canvasPadding,
  maxColumns,
]) {
  control.addEventListener("input", scheduleRender);
  control.addEventListener("change", scheduleRender);
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ink][data-background]")) {
  button.addEventListener("click", () => {
    inkColor.value = button.dataset.ink ?? "#111111";
    backgroundColor.value = button.dataset.background ?? "#ffffff";
    transparentBackground.checked = false;
    scheduleRender();
  });
}

downloadButton.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (!blob) {
      status.textContent = "PNG画像を作成できませんでした。";
      status.dataset.state = "error";
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "hunter-moji.png";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
  }, "image/png");
});

void render();
