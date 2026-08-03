import "./styles.css";
import {
  ACCEPTED_IMAGE_TYPES,
  formatFileSize,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from "./app/file-validation";
import {
  composeKana,
  getSupportedModifiers,
  KANA_MODIFIER_LABELS,
  type KanaModifier,
} from "./domain/kana-composition";
import { composeSmallKana, SMALL_KANA_BASES } from "./domain/small-kana";
import { assessRecognitionReview } from "./domain/recognition-review";
import {
  resolveGlyphModifier,
  resolveGlyphOutput,
  type GlyphModifierSelection,
  type GlyphSize,
  type GlyphSizeSelection,
} from "./domain/recognition-result";
import { loadOpenCv, type OpenCvLoadState } from "./opencv";
import { resolvePublicAsset } from "./glyphs/assets";
import { horizontalGlyphs } from "./glyphs/glyph-map";
import { loadGlyphTemplate, type LoadedGlyphTemplate } from "./glyphs/load-templates";
import {
  loadImageAsBinaryGlyph,
  loadImageAsBinaryGlyphVariants,
  type NormalizedCrop,
} from "./image/load";
import { evaluateShiftRobustness } from "./recognition/evaluation";
import {
  summarizeEvaluationRecords,
  type StoredEvaluationRecord,
} from "./recognition/evaluation-summary";
import { evaluateDetailedRecognition } from "./recognition/detailed-evaluation";
import { extractBasicFeatures } from "./recognition/features";
import { evaluateTranscription } from "./recognition/label-evaluation";
import { normalizeBinaryGlyph } from "./recognition/normalize";
import { rankGlyphCandidates, type GlyphCandidate } from "./recognition/similarity";
import { createSmallBinaryGlyph } from "./recognition/small-glyph";
import { recognizeInWorker } from "./recognition/recognition-worker-client";
import type { RuntimeRecognizedGlyph } from "./recognition/recognition-pipeline";
import { drawBinaryGlyph } from "./ui/binary-preview";
import { buildCorrectionChoices } from "./ui/correction-choices";
import {
  buildGlyphModifierChoices,
  coerceGlyphModifierSelection,
} from "./ui/glyph-modifier-control";
import { buildGlyphSizeChoices, coerceGlyphSizeSelection } from "./ui/glyph-size-control";
import {
  calculatePannedScroll,
  clampCropZoom,
  cropZoomFromWheel,
  fitCropPreviewSize,
} from "./ui/crop-zoom";

let currentRecognizedGlyphs: RuntimeRecognizedGlyph[] = [];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) throw new Error("アプリの表示領域が見つかりません。");

const glyphCards = horizontalGlyphs
  .map(
    (glyph) => `
      <article class="glyph-card">
        <div class="glyph-canvas">
          <img src="${resolvePublicAsset(glyph.templatePath)}" alt="ハンター文字 ${glyph.kana}" />
        </div>
        <div class="glyph-meta">
          <div>
            <strong>${glyph.kana}</strong>
            <span>${glyph.id.toUpperCase()} · DRAFT</span>
          </div>
          <small id="glyph-feature-${glyph.id}">解析待ち</small>
        </div>
      </article>
    `,
  )
  .join("");

const modifierBaseGlyphs = horizontalGlyphs.filter(
  (glyph) => glyph.supportsDakuten || glyph.supportsHandakuten,
);

const outputKana = new Set<string>(horizontalGlyphs.map((glyph) => glyph.kana));
for (const glyph of horizontalGlyphs) {
  for (const modifier of ["dakuten", "handakuten"] as const) {
    const result = composeKana(glyph.kana, modifier);
    if (result.ok) outputKana.add(result.kana);
  }
  const smallResult = composeSmallKana(glyph.kana);
  if (smallResult.ok) outputKana.add(smallResult.kana);
}
const composedKanaCount = outputKana.size - horizontalGlyphs.length;

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <p class="eyebrow">HUNTER MOJI READER</p>
        <h1>ハンター文字 <span>OCR</span></h1>
        <p class="lead">画像の文字を、読めるひらがなへ。</p>
      </div>
      <a class="generator-link" href="${import.meta.env.BASE_URL}generator.html">文字画像を作る</a>
    </header>

    <section class="privacy-note" aria-label="プライバシーについて">
      <span class="privacy-icon" aria-hidden="true">✓</span>
      <div>
        <strong>画像は端末の外へ送信されません</strong>
        <p>選択した画像は、このブラウザ内だけで処理します。</p>
      </div>
    </section>

    <section class="workspace" aria-labelledby="upload-heading">
      <div class="section-heading">
        <div>
          <p class="step">STEP 01</p>
          <h2 id="upload-heading">画像を選択</h2>
        </div>
        <span class="format-note">PNG・JPEG・WebP / 最大 ${formatFileSize(MAX_IMAGE_BYTES)}</span>
      </div>

      <label class="drop-zone" for="image-input">
        <input
          id="image-input"
          type="file"
          accept="${ACCEPTED_IMAGE_TYPES.join(",")}"
          aria-describedby="file-message"
        />
        <span class="upload-symbol" aria-hidden="true">＋</span>
        <strong>画像を選ぶ</strong>
        <span>または、ここにドラッグ＆ドロップ</span>
      </label>
      <p id="file-message" class="file-message" role="status">まだ画像は選択されていません。</p>

      <figure class="preview" hidden>
        <div class="crop-guide">
          <strong>左ドラッグで範囲選択・右ドラッグで画像移動</strong>
          <span>ホイールで拡大縮小できます。緑の枠内だけを処理します。</span>
        </div>
        <div class="crop-toolbar" aria-label="画像の表示倍率">
          <span>表示倍率</span>
          <button id="zoom-out" type="button" aria-label="縮小">−</button>
          <input id="crop-zoom" type="range" min="100" max="400" step="25" value="100" aria-label="画像の表示倍率" />
          <output id="zoom-value" for="crop-zoom">100%</output>
          <button id="zoom-in" type="button" aria-label="拡大">＋</button>
          <button id="fit-image" type="button">全体表示</button>
        </div>
        <div class="crop-viewport">
          <div class="crop-stage">
            <img id="image-preview" alt="選択した画像のプレビュー" draggable="false" />
            <div class="crop-selection" hidden aria-hidden="true"></div>
          </div>
        </div>
        <div class="crop-controls">
          <button id="reset-crop" type="button" disabled>画像全体に戻す</button>
          <span id="crop-status" role="status">画像全体を認識します。</span>
        </div>
        <figcaption id="preview-caption"></figcaption>
      </figure>

      <section class="single-glyph-panel" aria-labelledby="single-glyph-heading">
        <div>
          <p class="step">EXPERIMENT</p>
          <h3 id="single-glyph-heading">1文字画像を候補と照合</h3>
          <p>白または単純な背景にある1文字を、自動で切り抜いて64×64へ整えます。</p>
        </div>
        <button id="recognize-single" type="button" disabled>この画像を照合</button>
        <div class="normalized-result" hidden>
          <canvas id="normalized-preview" aria-label="正規化した二値画像"></canvas>
          <div>
            <p id="single-status" class="single-status" role="status"></p>
            <ol id="single-candidate-results" class="candidate-results" aria-live="polite"></ol>
          </div>
        </div>
      </section>

      <section class="multi-glyph-panel" aria-labelledby="multi-glyph-heading">
        <div>
          <p class="step">MULTI OCR · BETA</p>
          <h3 id="multi-glyph-heading">複数文字画像を認識</h3>
          <p>白または単純な背景から行と文字候補を切り出し、左から右・上から下へ照合します。</p>
        </div>
        <div class="multi-recognition-actions">
          <label for="binarization-mode">
            背景処理
            <select id="binarization-mode">
              <option value="auto">自動選択</option>
              <option value="background">背景色との差</option>
              <option value="dark-ink">黒い線を優先</option>
              <option value="local-contrast">局所コントラスト</option>
              <option value="local-color">局所色差</option>
              <option value="sauvola">局所分散（Sauvola）</option>
              <option value="neutral-ink">無彩色の黒線</option>
            </select>
          </label>
          <button id="recognize-multiple" type="button" disabled>複数文字を認識</button>
        </div>
        <div class="multi-result" hidden>
          <div class="multi-summary">
            <p id="multi-status" class="single-status" role="status"></p>
            <pre id="multi-text" aria-label="複数文字の認識結果"></pre>
            <div class="multi-output-actions">
              <button id="copy-multi-text" type="button" disabled>結果をコピー</button>
              <span id="copy-multi-status" role="status"></span>
            </div>
          </div>
          <div id="multi-candidate-grid" class="multi-candidate-grid" aria-live="polite"></div>
          <section class="ground-truth-panel" aria-labelledby="ground-truth-heading">
            <div>
              <p class="step">GROUND TRUTH</p>
              <h4 id="ground-truth-heading">正解ラベル</h4>
              <p>画像の正しい読みを行ごとに入力します。ラベルはこのブラウザ内だけに保存されます。</p>
            </div>
            <label for="ground-truth-input">正解文字列</label>
            <textarea id="ground-truth-input" rows="3" placeholder="例：ざんぎょう\nちゅうです"></textarea>
            <div class="ground-truth-actions">
              <button id="use-recognized-text" type="button" disabled>認識結果を反映</button>
              <button id="save-ground-truth" type="button">この画像の正解を保存</button>
            </div>
            <dl class="label-metrics">
              <div><dt>文字精度</dt><dd id="label-character-accuracy">--</dd></div>
              <div><dt>行完全一致率</dt><dd id="label-line-accuracy">--</dd></div>
              <div><dt>全文一致</dt><dd id="label-exact-match">--</dd></div>
            </dl>
            <p id="ground-truth-status" class="ground-truth-status" role="status">正解ラベルを入力すると評価します。</p>
            <div class="local-benchmark" aria-label="保存済み正解ラベルの集計">
              <p class="step">LOCAL BENCHMARK</p>
              <dl class="label-metrics">
                <div><dt>評価画像</dt><dd id="benchmark-image-count">0枚</dd></div>
                <div><dt>累計文字精度</dt><dd id="benchmark-character-accuracy">--</dd></div>
                <div><dt>候補数比率</dt><dd id="benchmark-segmentation-ratio">--</dd></div>
                <div><dt>文字数一致</dt><dd id="benchmark-segmentation-exact">--</dd></div>
                <div><dt>Top-1 / Top-3</dt><dd id="benchmark-top-candidates">--</dd></div>
                <div><dt>濁点</dt><dd id="benchmark-dakuten">--</dd></div>
                <div><dt>半濁点</dt><dd id="benchmark-handakuten">--</dd></div>
                <div><dt>小書き</dt><dd id="benchmark-small">--</dd></div>
                <div><dt>全文一致</dt><dd id="benchmark-exact-rate">--</dd></div>
              </dl>
              <p class="ground-truth-status">保存した正解ラベルを再認識すると、端末内だけで集計します。</p>
            </div>
          </section>
        </div>
      </section>
    </section>

    <section class="system-card" aria-labelledby="system-heading">
      <div>
        <p class="step">SYSTEM</p>
        <h2 id="system-heading">高度画像処理エンジン</h2>
      </div>
      <div class="engine-status" data-state="idle">
        <span class="status-dot" aria-hidden="true"></span>
        <div>
            <strong id="opencv-status" role="status">基本認識は利用できます</strong>
            <span id="opencv-detail">OpenCV.jsは高度な切り抜き・傾き補正用です。</span>
        </div>
        <button id="opencv-retry" class="text-button" type="button">高度処理を準備</button>
      </div>
    </section>

    <section class="template-library" aria-labelledby="template-heading">
      <div class="section-heading">
        <div>
          <p class="step">GLYPH LIBRARY</p>
          <h2 id="template-heading">字形テンプレート</h2>
        </div>
        <span class="template-count">基本SVG ${horizontalGlyphs.length}字 · 出力 ${outputKana.size}かな</span>
      </div>
      <p class="template-description">ここに表示する独自SVGは基本${horizontalGlyphs.length}字です。濁点・半濁点と小書きの${composedKanaCount}字は基本字形から合成し、合計${outputKana.size}字のひらがなを出力できます。</p>
      <p id="template-status" class="template-status" role="status">基本${horizontalGlyphs.length}字の64×64特徴量を生成しています。</p>
      <div class="glyph-grid">${glyphCards}</div>
      <div class="ranking-demo">
        <div>
          <p class="step">SIMILARITY DEMO</p>
          <h3>上位3候補を確認</h3>
          <p>登録済み字形を入力例として、複数の特徴量から候補を順位付けします。</p>
        </div>
        <div class="ranking-controls">
          <label for="ranking-input">入力字形</label>
          <select id="ranking-input" disabled>
            ${horizontalGlyphs.map((glyph) => `<option value="${glyph.id}">${glyph.kana}</option>`).join("")}
          </select>
          <button id="ranking-run" type="button" disabled>候補を確認</button>
        </div>
        <ol id="candidate-results" class="candidate-results" aria-live="polite">
          <li>字形データを準備しています。</li>
        </ol>
      </div>
      <div class="robustness-check">
        <div>
          <p class="step">TEMPLATE SELF-CHECK</p>
          <h3>テンプレートの位置ずれ検査</h3>
          <p>独自SVGを上下左右へ2pxずらした内部検査です。実写画像のOCR精度ではありません。</p>
        </div>
        <button id="robustness-run" type="button" disabled>再評価</button>
        <dl class="evaluation-metrics">
          <div><dt>1位一致率</dt><dd id="character-accuracy">--</dd></div>
          <div><dt>全条件一致率</dt><dd id="sequence-accuracy">--</dd></div>
          <div><dt>低信頼率</dt><dd id="uncertain-rate">--</dd></div>
        </dl>
        <p id="evaluation-status" class="evaluation-status" role="status">字形データを準備しています。</p>
      </div>
      <div class="modifier-demo">
        <div>
          <p class="step">COMPOSITION</p>
          <h3>濁点・半濁点の合成</h3>
          <p>文字本体と修飾記号を別レイヤーとして扱い、最後にかなへ合成します。</p>
        </div>
        <div class="modifier-controls">
          <label for="modifier-base">基底文字</label>
          <select id="modifier-base">
            ${modifierBaseGlyphs.map((glyph) => `<option value="${glyph.kana}">${glyph.kana}</option>`).join("")}
          </select>
          <label for="modifier-kind">修飾記号</label>
          <select id="modifier-kind">
            <option value="dakuten">濁点</option>
            <option value="handakuten">半濁点</option>
          </select>
        </div>
        <div class="composition-result">
          <strong id="composed-kana" aria-hidden="true">が</strong>
          <p id="composition-status" role="status">か + 濁点 → が</p>
        </div>
      </div>
      <div class="small-form-demo">
        <div>
          <p class="step">SMALL FORM</p>
          <h3>小書き文字の合成</h3>
          <p>基本字形を70%へ縮小し、行内の相対サイズを保ったまま小書きかなへ変換します。</p>
        </div>
        <label for="small-form-base">基本字形</label>
        <select id="small-form-base">
          ${SMALL_KANA_BASES.map((kana) => `<option value="${kana}">${kana}</option>`).join("")}
        </select>
        <div class="small-form-result">
          <canvas id="small-form-preview" aria-label="縮小した小書き字形"></canvas>
          <strong id="small-form-kana">っ</strong>
          <p id="small-form-status" role="status">字形データを準備しています。</p>
        </div>
      </div>
    </section>

    <section class="coming-next" aria-label="今後追加する機能">
      <p class="step">COMING NEXT</p>
      <div class="next-grid">
        <span>傾き・遠近を補正</span>
        <span>縦書きへ対応</span>
        <span>正解ラベルから候補を補正</span>
      </div>
    </section>

    <footer>
      <p>非公式ファンツールです。作品および権利者とは関係ありません。</p>
      <p>現在は試験版です。認識結果は候補と正解ラベルで確認してください。</p>
    </footer>
  </main>
`;

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の初期化に必要な要素が見つかりません: ${selector}`);
  return element;
}

const input = getRequiredElement<HTMLInputElement>("#image-input");
const fileMessage = getRequiredElement<HTMLParagraphElement>("#file-message");
const preview = getRequiredElement<HTMLElement>(".preview");
const previewImage = getRequiredElement<HTMLImageElement>("#image-preview");
const previewCaption = getRequiredElement<HTMLElement>("#preview-caption");
const cropViewport = getRequiredElement<HTMLElement>(".crop-viewport");
const cropStage = getRequiredElement<HTMLElement>(".crop-stage");
const cropSelection = getRequiredElement<HTMLElement>(".crop-selection");
const resetCrop = getRequiredElement<HTMLButtonElement>("#reset-crop");
const cropStatus = getRequiredElement<HTMLElement>("#crop-status");
const zoomOut = getRequiredElement<HTMLButtonElement>("#zoom-out");
const zoomInput = getRequiredElement<HTMLInputElement>("#crop-zoom");
const zoomValue = getRequiredElement<HTMLOutputElement>("#zoom-value");
const zoomIn = getRequiredElement<HTMLButtonElement>("#zoom-in");
const fitImage = getRequiredElement<HTMLButtonElement>("#fit-image");
const dropZone = getRequiredElement<HTMLElement>(".drop-zone");
const engineStatus = getRequiredElement<HTMLElement>(".engine-status");
const opencvStatus = getRequiredElement<HTMLElement>("#opencv-status");
const opencvDetail = getRequiredElement<HTMLElement>("#opencv-detail");
const retryButton = getRequiredElement<HTMLButtonElement>("#opencv-retry");
const templateStatus = getRequiredElement<HTMLParagraphElement>("#template-status");
const rankingInput = getRequiredElement<HTMLSelectElement>("#ranking-input");
const rankingRun = getRequiredElement<HTMLButtonElement>("#ranking-run");
const candidateResults = getRequiredElement<HTMLOListElement>("#candidate-results");
const recognizeSingle = getRequiredElement<HTMLButtonElement>("#recognize-single");
const normalizedResult = getRequiredElement<HTMLElement>(".normalized-result");
const normalizedPreview = getRequiredElement<HTMLCanvasElement>("#normalized-preview");
const singleStatus = getRequiredElement<HTMLParagraphElement>("#single-status");
const singleCandidateResults = getRequiredElement<HTMLOListElement>("#single-candidate-results");
const recognizeMultiple = getRequiredElement<HTMLButtonElement>("#recognize-multiple");
const binarizationMode = getRequiredElement<HTMLSelectElement>("#binarization-mode");
const multiResult = getRequiredElement<HTMLElement>(".multi-result");
const multiStatus = getRequiredElement<HTMLParagraphElement>("#multi-status");
const multiText = getRequiredElement<HTMLElement>("#multi-text");
const copyMultiText = getRequiredElement<HTMLButtonElement>("#copy-multi-text");
const copyMultiStatus = getRequiredElement<HTMLElement>("#copy-multi-status");
const multiCandidateGrid = getRequiredElement<HTMLElement>("#multi-candidate-grid");
const groundTruthInput = getRequiredElement<HTMLTextAreaElement>("#ground-truth-input");
const useRecognizedText = getRequiredElement<HTMLButtonElement>("#use-recognized-text");
const saveGroundTruth = getRequiredElement<HTMLButtonElement>("#save-ground-truth");
const labelCharacterAccuracy = getRequiredElement<HTMLElement>("#label-character-accuracy");
const labelLineAccuracy = getRequiredElement<HTMLElement>("#label-line-accuracy");
const labelExactMatch = getRequiredElement<HTMLElement>("#label-exact-match");
const groundTruthStatus = getRequiredElement<HTMLParagraphElement>("#ground-truth-status");
const benchmarkImageCount = getRequiredElement<HTMLElement>("#benchmark-image-count");
const benchmarkCharacterAccuracy = getRequiredElement<HTMLElement>("#benchmark-character-accuracy");
const benchmarkSegmentationRatio = getRequiredElement<HTMLElement>("#benchmark-segmentation-ratio");
const benchmarkSegmentationExact = getRequiredElement<HTMLElement>("#benchmark-segmentation-exact");
const benchmarkTopCandidates = getRequiredElement<HTMLElement>("#benchmark-top-candidates");
const benchmarkDakuten = getRequiredElement<HTMLElement>("#benchmark-dakuten");
const benchmarkHandakuten = getRequiredElement<HTMLElement>("#benchmark-handakuten");
const benchmarkSmall = getRequiredElement<HTMLElement>("#benchmark-small");
const benchmarkExactRate = getRequiredElement<HTMLElement>("#benchmark-exact-rate");
const robustnessRun = getRequiredElement<HTMLButtonElement>("#robustness-run");
const characterAccuracy = getRequiredElement<HTMLElement>("#character-accuracy");
const sequenceAccuracy = getRequiredElement<HTMLElement>("#sequence-accuracy");
const uncertainRate = getRequiredElement<HTMLElement>("#uncertain-rate");
const evaluationStatus = getRequiredElement<HTMLParagraphElement>("#evaluation-status");
const modifierBase = getRequiredElement<HTMLSelectElement>("#modifier-base");
const modifierKind = getRequiredElement<HTMLSelectElement>("#modifier-kind");
const composedKana = getRequiredElement<HTMLElement>("#composed-kana");
const compositionStatus = getRequiredElement<HTMLParagraphElement>("#composition-status");
const smallFormBase = getRequiredElement<HTMLSelectElement>("#small-form-base");
const smallFormPreview = getRequiredElement<HTMLCanvasElement>("#small-form-preview");
const smallFormKana = getRequiredElement<HTMLElement>("#small-form-kana");
const smallFormStatus = getRequiredElement<HTMLParagraphElement>("#small-form-status");

let previewUrl: string | null = null;
let selectedImageFile: File | null = null;
let activeRecognitionController: AbortController | null = null;
let selectedCrop: NormalizedCrop | null = null;
let cropDragStart: { x: number; y: number } | null = null;
let cropBeforeDrag: NormalizedCrop | null = null;
let cropPanStart: {
  pointerId: number;
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
} | null = null;
let cropZoom = 1;
let groundTruthAutoLinked = true;
let lastCropWheelZoomAt = Number.NEGATIVE_INFINITY;
const MIN_CROP_ZOOM = 1;
const MAX_CROP_ZOOM = 4;
const CROP_ZOOM_STEP = 0.25;
const EVALUATION_STORAGE_KEY = "hunter-moji-ocr:evaluation-records:v1";

function groundTruthStorageKey(file: File): string {
  return `hunter-moji-ocr:ground-truth:${file.name}:${file.size}:${file.lastModified}`;
}

function loadGroundTruth(file: File): string {
  try {
    return localStorage.getItem(groundTruthStorageKey(file)) ?? "";
  } catch {
    return "";
  }
}

function loadEvaluationRecords(): Record<string, StoredEvaluationRecord> {
  try {
    const stored = JSON.parse(localStorage.getItem(EVALUATION_STORAGE_KEY) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, StoredEvaluationRecord] => {
        const record = entry[1] as Partial<StoredEvaluationRecord>;
        const validCore =
          Number.isInteger(record.expectedCharacters) &&
          (record.expectedCharacters ?? -1) >= 0 &&
          Number.isInteger(record.predictedCharacters) &&
          (record.predictedCharacters ?? -1) >= 0 &&
          Number.isInteger(record.editDistance) &&
          (record.editDistance ?? -1) >= 0 &&
          typeof record.exactMatch === "boolean";
        if (!validCore) return false;
        if (record.segmentationExact === undefined) return true;
        const categoryCounts = record.categoryCounts;
        return (
          typeof record.segmentationExact === "boolean" &&
          Number.isInteger(record.alignedCharacters) &&
          (record.alignedCharacters ?? -1) >= 0 &&
          Number.isInteger(record.top1Correct) &&
          (record.top1Correct ?? -1) >= 0 &&
          Number.isInteger(record.top3Correct) &&
          (record.top3Correct ?? -1) >= 0 &&
          categoryCounts !== undefined &&
          [categoryCounts.dakuten, categoryCounts.handakuten, categoryCounts.small].every(
            (category) =>
              category !== undefined &&
              Number.isInteger(category.total) &&
              category.total >= 0 &&
              Number.isInteger(category.top1Correct) &&
              category.top1Correct >= 0 &&
              Number.isInteger(category.top3Correct) &&
              category.top3Correct >= 0,
          )
        );
      }),
    );
  } catch {
    return {};
  }
}

function renderEvaluationSummary(): void {
  const records = Object.values(loadEvaluationRecords());
  const summary = summarizeEvaluationRecords(records);
  benchmarkImageCount.textContent = `${summary.imageCount}枚`;
  benchmarkCharacterAccuracy.textContent = summary.imageCount
    ? `${(summary.characterAccuracy * 100).toFixed(1)}%`
    : "--";
  benchmarkSegmentationRatio.textContent = summary.imageCount
    ? `${(summary.segmentationRatio * 100).toFixed(1)}%`
    : "--";
  benchmarkSegmentationExact.textContent = summary.detailedImageCount
    ? `${summary.segmentationExactCount}/${summary.detailedImageCount}`
    : "--";
  benchmarkTopCandidates.textContent = summary.alignedCharacters
    ? `${(summary.top1Accuracy * 100).toFixed(1)}% / ${(summary.top3Accuracy * 100).toFixed(1)}%`
    : "--";
  const formatCategory = (category: (typeof summary.categories)["dakuten"]): string =>
    category.total
      ? `${category.top1Correct}/${category.total} · Top-3 ${category.top3Correct}/${category.total}`
      : "--";
  benchmarkDakuten.textContent = formatCategory(summary.categories.dakuten);
  benchmarkHandakuten.textContent = formatCategory(summary.categories.handakuten);
  benchmarkSmall.textContent = formatCategory(summary.categories.small);
  benchmarkExactRate.textContent = summary.imageCount
    ? `${summary.exactMatchCount}/${summary.imageCount}`
    : "--";
}

function resolveAutomaticCandidateKana(item: RuntimeRecognizedGlyph, baseKana: string): string {
  const detectedModifier =
    item.detectedModifier && getSupportedModifiers(baseKana).includes(item.detectedModifier)
      ? item.detectedModifier
      : null;
  const modifier = resolveGlyphModifier("auto", detectedModifier, item.modifierConfidence);
  return resolveGlyphOutput(baseKana, "auto", item.automaticSize, modifier).kana;
}

function automaticRecognitionEvaluationData(): {
  predicted: string;
  topCandidates: string[][];
} | null {
  if (currentRecognizedGlyphs.length === 0) return null;
  const lines = new Map<number, string[]>();
  const topCandidates: string[][] = [];
  for (const item of currentRecognizedGlyphs) {
    const resolvedCandidates = item.candidates.map(({ kana }) =>
      resolveAutomaticCandidateKana(item, kana),
    );
    const values = lines.get(item.lineIndex) ?? [];
    values.push(resolvedCandidates[0] ?? "");
    lines.set(item.lineIndex, values);
    topCandidates.push(resolvedCandidates);
  }
  return {
    predicted: [...lines.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, values]) => values.join(""))
      .join("\n"),
    topCandidates,
  };
}

function updateStoredEvaluation(): void {
  if (!selectedImageFile || groundTruthInput.dataset.source !== "saved") return;
  const records = loadEvaluationRecords();
  const key = groundTruthStorageKey(selectedImageFile);
  const expected = groundTruthInput.value.trim();
  if (!expected) {
    delete records[key];
  } else {
    const automatic = automaticRecognitionEvaluationData();
    const evaluation = evaluateTranscription(
      automatic?.predicted ?? multiText.textContent ?? "",
      expected,
    );
    const detailed = automatic
      ? evaluateDetailedRecognition(expected, automatic.predicted, automatic.topCandidates)
      : null;
    records[key] = {
      expectedCharacters: evaluation.expectedCharacters,
      predictedCharacters: evaluation.predicted.replaceAll("\n", "").length,
      editDistance: evaluation.editDistance,
      exactMatch: evaluation.exactMatch,
      ...(detailed
        ? {
            segmentationExact: detailed.segmentationExact,
            alignedCharacters: detailed.alignedCharacters,
            top1Correct: detailed.top1Correct,
            top3Correct: detailed.top3Correct,
            categoryCounts: detailed.categories,
          }
        : {}),
    };
  }
  try {
    localStorage.setItem(EVALUATION_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // The current per-image evaluation remains usable when storage is unavailable.
  }
  renderEvaluationSummary();
}

function updateSingleRecognitionAvailability(): void {
  const unavailable = selectedImageFile === null || loadedGlyphTemplates.length === 0;
  recognizeSingle.disabled = unavailable;
  recognizeMultiple.disabled = unavailable;
}

function renderCropSelection(message?: string): void {
  cropSelection.hidden = selectedCrop === null;
  resetCrop.disabled = selectedCrop === null;
  if (!selectedCrop) {
    cropStatus.textContent = message ?? "画像全体を認識します。";
    return;
  }
  cropSelection.style.left = `${selectedCrop.x * 100}%`;
  cropSelection.style.top = `${selectedCrop.y * 100}%`;
  cropSelection.style.width = `${selectedCrop.width * 100}%`;
  cropSelection.style.height = `${selectedCrop.height * 100}%`;
  cropStatus.textContent =
    message ??
    `選択範囲: 横${(selectedCrop.width * 100).toFixed(0)}% × 縦${(selectedCrop.height * 100).toFixed(0)}%`;
}

function renderCropZoom(): void {
  const percentage = Math.round(cropZoom * 100);
  zoomInput.value = String(percentage);
  zoomValue.value = `${percentage}%`;
  zoomOut.disabled = cropZoom <= MIN_CROP_ZOOM;
  zoomIn.disabled = cropZoom >= MAX_CROP_ZOOM;
  fitImage.disabled = cropZoom === MIN_CROP_ZOOM;
}

function layoutCropPreview(preserveCenter = true, anchorClient?: { x: number; y: number }): void {
  if (!previewImage.naturalWidth || !previewImage.naturalHeight) return;

  const previousWidth = cropViewport.scrollWidth || 1;
  const previousHeight = cropViewport.scrollHeight || 1;
  const viewportBounds = cropViewport.getBoundingClientRect();
  const anchorOffsetX = anchorClient
    ? Math.max(0, Math.min(cropViewport.clientWidth, anchorClient.x - viewportBounds.left))
    : cropViewport.clientWidth / 2;
  const anchorOffsetY = anchorClient
    ? Math.max(0, Math.min(cropViewport.clientHeight, anchorClient.y - viewportBounds.top))
    : cropViewport.clientHeight / 2;
  const anchorX = (cropViewport.scrollLeft + anchorOffsetX) / previousWidth;
  const anchorY = (cropViewport.scrollTop + anchorOffsetY) / previousHeight;
  const base = fitCropPreviewSize(
    previewImage.naturalWidth,
    previewImage.naturalHeight,
    Math.max(1, cropViewport.clientWidth),
  );

  cropStage.style.width = `${base.width * cropZoom}px`;
  cropStage.style.height = `${base.height * cropZoom}px`;
  renderCropZoom();

  requestAnimationFrame(() => {
    if (!preserveCenter) {
      cropViewport.scrollTo({ left: 0, top: 0 });
      return;
    }
    cropViewport.scrollTo({
      left: anchorX * cropViewport.scrollWidth - anchorOffsetX,
      top: anchorY * cropViewport.scrollHeight - anchorOffsetY,
    });
  });
}

function setCropZoom(zoom: number, anchorClient?: { x: number; y: number }): void {
  cropZoom = clampCropZoom(zoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  layoutCropPreview(true, anchorClient);
}

function pointerPositionInPreview(event: PointerEvent): { x: number; y: number } {
  const bounds = previewImage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function invalidateRecognitionResults(): void {
  activeRecognitionController?.abort();
  activeRecognitionController = null;
  normalizedResult.hidden = true;
  multiResult.hidden = true;
  useRecognizedText.disabled = true;
}

function finishCropDrag(): void {
  if (!cropDragStart || !selectedCrop) return;
  if (selectedCrop.width < 0.02 || selectedCrop.height < 0.02) {
    selectedCrop = cropBeforeDrag;
    renderCropSelection("範囲が小さすぎるため、直前の選択へ戻しました。");
  } else {
    renderCropSelection();
    invalidateRecognitionResults();
  }
  cropDragStart = null;
  cropBeforeDrag = null;
}

function showImage(file: File): void {
  activeRecognitionController?.abort();
  activeRecognitionController = null;
  const validation = validateImageFile(file);
  if (!validation.ok) {
    selectedImageFile = null;
    fileMessage.textContent = validation.message;
    fileMessage.dataset.state = "error";
    input.value = "";
    updateSingleRecognitionAvailability();
    return;
  }

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  previewCaption.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  preview.hidden = false;
  normalizedResult.hidden = true;
  multiResult.hidden = true;
  useRecognizedText.disabled = true;
  selectedImageFile = file;
  selectedCrop = null;
  cropDragStart = null;
  cropPanStart = null;
  delete cropStage.dataset.panning;
  cropZoom = MIN_CROP_ZOOM;
  renderCropZoom();
  renderCropSelection();
  const savedGroundTruth = loadGroundTruth(file);
  groundTruthInput.value = savedGroundTruth;
  groundTruthAutoLinked = savedGroundTruth.trim().length === 0;
  groundTruthInput.dataset.source = savedGroundTruth.trim() ? "saved" : "recognition";
  renderLabelEvaluation();
  fileMessage.textContent = "画像を端末内に読み込みました。外部への送信は行っていません。";
  fileMessage.dataset.state = "success";
  updateSingleRecognitionAvailability();
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) showImage(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = "true";
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    delete dropZone.dataset.dragging;
  });
}

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) showImage(file);
});

cropStage.addEventListener("pointerdown", (event) => {
  if (!selectedImageFile || (event.button !== 0 && event.button !== 2)) return;
  event.preventDefault();
  cropStage.setPointerCapture(event.pointerId);
  if (event.button === 2) {
    cropPanStart = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: cropViewport.scrollLeft,
      scrollTop: cropViewport.scrollTop,
    };
    cropStage.dataset.panning = "true";
    return;
  }
  cropBeforeDrag = selectedCrop;
  cropDragStart = pointerPositionInPreview(event);
  selectedCrop = { x: cropDragStart.x, y: cropDragStart.y, width: 0.001, height: 0.001 };
  renderCropSelection("範囲を選択しています。");
});

cropStage.addEventListener("pointermove", (event) => {
  if (cropPanStart?.pointerId === event.pointerId) {
    event.preventDefault();
    const nextScroll = calculatePannedScroll(
      { x: cropPanStart.scrollLeft, y: cropPanStart.scrollTop },
      { x: cropPanStart.clientX, y: cropPanStart.clientY },
      { x: event.clientX, y: event.clientY },
    );
    cropViewport.scrollLeft = nextScroll.x;
    cropViewport.scrollTop = nextScroll.y;
    return;
  }
  if (!cropDragStart) return;
  const current = pointerPositionInPreview(event);
  selectedCrop = {
    x: Math.min(cropDragStart.x, current.x),
    y: Math.min(cropDragStart.y, current.y),
    width: Math.max(0.001, Math.abs(current.x - cropDragStart.x)),
    height: Math.max(0.001, Math.abs(current.y - cropDragStart.y)),
  };
  renderCropSelection("範囲を選択しています。");
});

cropStage.addEventListener("pointerup", (event) => {
  if (cropStage.hasPointerCapture(event.pointerId))
    cropStage.releasePointerCapture(event.pointerId);
  if (cropPanStart?.pointerId === event.pointerId) {
    cropPanStart = null;
    delete cropStage.dataset.panning;
    return;
  }
  finishCropDrag();
});

cropStage.addEventListener("pointercancel", () => {
  cropPanStart = null;
  delete cropStage.dataset.panning;
  selectedCrop = cropBeforeDrag;
  cropDragStart = null;
  cropBeforeDrag = null;
  renderCropSelection();
});

cropStage.addEventListener("contextmenu", (event) => event.preventDefault());

cropStage.addEventListener(
  "wheel",
  (event) => {
    const nextZoom = clampCropZoom(
      cropZoomFromWheel(cropZoom, event.deltaY, CROP_ZOOM_STEP),
      MIN_CROP_ZOOM,
      MAX_CROP_ZOOM,
    );
    if (nextZoom === cropZoom) return;
    event.preventDefault();
    if (event.timeStamp - lastCropWheelZoomAt < 60) return;
    lastCropWheelZoomAt = event.timeStamp;
    setCropZoom(nextZoom, { x: event.clientX, y: event.clientY });
  },
  { passive: false },
);

resetCrop.addEventListener("click", () => {
  selectedCrop = null;
  renderCropSelection();
  invalidateRecognitionResults();
});

previewImage.addEventListener("load", () => layoutCropPreview(false));

zoomOut.addEventListener("click", () => setCropZoom(cropZoom - CROP_ZOOM_STEP));
zoomIn.addEventListener("click", () => setCropZoom(cropZoom + CROP_ZOOM_STEP));
zoomInput.addEventListener("input", () => setCropZoom(Number(zoomInput.value) / 100));
fitImage.addEventListener("click", () => {
  cropZoom = MIN_CROP_ZOOM;
  layoutCropPreview(false);
});

window.addEventListener("resize", () => layoutCropPreview());

function setOpenCvState(state: OpenCvLoadState, detail?: string): void {
  engineStatus.dataset.state = state;
  retryButton.hidden = state === "loading" || state === "ready";
  retryButton.textContent = state === "error" ? "再試行" : "高度処理を準備";

  const labels: Record<OpenCvLoadState, string> = {
    idle: "基本認識は利用できます",
    loading: "OpenCV.js を読み込み中",
    ready: "OpenCV.js の準備ができました",
    error: "OpenCV.js を読み込めませんでした",
  };

  opencvStatus.textContent = labels[state];
  opencvDetail.textContent =
    detail ??
    (state === "ready"
      ? "高度な切り抜き・傾き補正を追加できる状態です。"
      : "OpenCV.jsは高度な切り抜き・傾き補正用です。");
}

async function initializeOpenCv(): Promise<void> {
  setOpenCvState("loading");
  try {
    await loadOpenCv();
    setOpenCvState("ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    setOpenCvState("error", `${message} ネットワーク接続を確認して再試行してください。`);
  }
}

retryButton.addEventListener("click", () => void initializeOpenCv());
window.addEventListener("beforeunload", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});

setOpenCvState("idle", "必要になったときに画像処理エンジンを準備します。");

let loadedGlyphTemplates: LoadedGlyphTemplate[] = [];

function renderCandidates(target: HTMLOListElement, candidates: readonly GlyphCandidate[]): void {
  target.innerHTML = candidates
    .map(
      (candidate, index) => `
        <li>
          <span class="candidate-rank">${index + 1}</span>
          <strong>${candidate.kana}</strong>
          <span>${(candidate.score * 100).toFixed(1)}%</span>
          <small>画像 ${(candidate.scoreBreakdown.bitmap * 100).toFixed(0)} · 射影 ${(candidate.scoreBreakdown.projection * 100).toFixed(0)}</small>
        </li>
      `,
    )
    .join("");
}

function renderCandidateRanking(): void {
  const input = loadedGlyphTemplates.find(
    (template) => template.definition.id === rankingInput.value,
  );
  if (!input) {
    candidateResults.innerHTML = "<li>入力字形を選択してください。</li>";
    return;
  }

  const candidates = rankGlyphCandidates(input, loadedGlyphTemplates);
  renderCandidates(candidateResults, candidates);
}

function runRobustnessEvaluation(): void {
  if (loadedGlyphTemplates.length === 0) return;
  robustnessRun.disabled = true;
  robustnessRun.textContent = "評価中…";

  try {
    const result = evaluateShiftRobustness(loadedGlyphTemplates);
    characterAccuracy.textContent = `${(result.characterAccuracy * 100).toFixed(1)}%`;
    sequenceAccuracy.textContent = `${(result.sequenceExactRate * 100).toFixed(1)}%`;
    uncertainRate.textContent = `${(result.uncertainRate * 100).toFixed(1)}%`;
    evaluationStatus.textContent = `${result.correctCharacters}/${result.totalCharacters}文字が正解 · ${result.exactSequences}/${result.totalSequences}条件で全字一致`;
    evaluationStatus.dataset.state = "success";
  } catch (error) {
    evaluationStatus.textContent =
      error instanceof Error ? error.message : "精度評価を実行できませんでした。";
    evaluationStatus.dataset.state = "error";
  } finally {
    robustnessRun.disabled = false;
    robustnessRun.textContent = "再評価";
  }
}

function renderKanaComposition(): void {
  const modifier = modifierKind.value as KanaModifier;
  const result = composeKana(modifierBase.value, modifier);
  if (result.ok) {
    composedKana.textContent = result.kana;
    compositionStatus.textContent = `${result.baseKana} + ${KANA_MODIFIER_LABELS[result.modifier]} → ${result.kana}`;
    compositionStatus.dataset.state = "success";
    return;
  }

  composedKana.textContent = "?";
  compositionStatus.textContent = `${result.baseKana} + ${KANA_MODIFIER_LABELS[result.modifier]} は未対応です。`;
  compositionStatus.dataset.state = "error";
}

function renderSmallKanaComposition(): void {
  const composition = composeSmallKana(smallFormBase.value);
  const template = loadedGlyphTemplates.find(
    (candidate) => candidate.definition.kana === smallFormBase.value,
  );
  if (!composition.ok || !template) {
    smallFormKana.textContent = "?";
    smallFormStatus.textContent = "小書き字形を生成できませんでした。";
    smallFormStatus.dataset.state = "error";
    return;
  }

  drawBinaryGlyph(smallFormPreview, createSmallBinaryGlyph(template.binary), 2);
  smallFormKana.textContent = composition.kana;
  smallFormStatus.textContent = `${composition.baseKana}を70%へ縮小 → ${composition.kana}`;
  smallFormStatus.dataset.state = "success";
}

async function recognizeSelectedSingleGlyph(): Promise<void> {
  if (!selectedImageFile || loadedGlyphTemplates.length === 0) return;

  recognizeSingle.disabled = true;
  recognizeSingle.textContent = "照合中…";
  normalizedResult.hidden = false;
  singleStatus.textContent = "画像を二値化しています。";
  singleStatus.dataset.state = "loading";
  singleCandidateResults.innerHTML = "";

  try {
    const source = await loadImageAsBinaryGlyph(selectedImageFile, selectedCrop);
    const binary = normalizeBinaryGlyph(source);
    const features = extractBasicFeatures(binary);
    if (features.foregroundRatio === 0) {
      throw new Error("濃い文字を検出できませんでした。白背景の1文字画像を選んでください。");
    }

    drawBinaryGlyph(normalizedPreview, binary);
    const candidates = rankGlyphCandidates({ binary, features }, loadedGlyphTemplates);
    renderCandidates(singleCandidateResults, candidates);
    singleStatus.textContent = `前景 ${(features.foregroundRatio * 100).toFixed(1)}% · 上位候補を表示しました。`;
    singleStatus.dataset.state = "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "画像を処理できませんでした。";
    singleStatus.textContent = message;
    singleStatus.dataset.state = "error";
  } finally {
    recognizeSingle.textContent = "この画像を照合";
    updateSingleRecognitionAvailability();
  }
}

function syncGroundTruthFromRecognition(force = false): void {
  const recognizedText = multiText.textContent ?? "";
  useRecognizedText.disabled = recognizedText.trim().length === 0;
  if (!recognizedText.trim() || (!force && !groundTruthAutoLinked)) return;

  groundTruthInput.value = recognizedText;
  groundTruthAutoLinked = true;
  groundTruthInput.dataset.source = "recognition";
}

const REVIEW_REASON_LABELS = {
  "no-candidate": "候補なし",
  "low-base-score": "字形の得点が低い",
  "close-base-candidates": "上位候補が僅差",
  "ambiguous-size": "文字サイズが境界付近",
  "ambiguous-modifier": "修飾記号が境界付近",
} as const;

function refreshRecognitionReview(index: number, item: RuntimeRecognizedGlyph): void {
  const card = multiCandidateGrid.querySelector<HTMLElement>(
    `.multi-candidate-card[data-result-index="${index}"]`,
  );
  const badge = multiCandidateGrid.querySelector<HTMLElement>(`[data-review-index="${index}"]`);
  if (!card || !badge) return;
  const assessment = assessRecognitionReview(item);
  card.dataset.reviewState = assessment.state;
  badge.dataset.state = assessment.state;
  badge.textContent =
    assessment.state === "accepted"
      ? "確認済み"
      : assessment.state === "unrecognized"
        ? "未認識"
        : "要確認";
  badge.title = assessment.reasons.map((reason) => REVIEW_REASON_LABELS[reason]).join("、");
}

function updateMultiText(): void {
  const lineValues = new Map<number, string[]>();
  multiCandidateGrid
    .querySelectorAll<HTMLSelectElement>("select[data-line-index]")
    .forEach((select) => {
      const lineIndex = Number(select.dataset.lineIndex);
      const values = lineValues.get(lineIndex) ?? [];
      const segmentIndex = select.dataset.segmentIndex;
      const item = segmentIndex ? currentRecognizedGlyphs[Number(segmentIndex)] : undefined;
      const modifierSelect = segmentIndex
        ? multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-modifier-index="${segmentIndex}"]`,
          )
        : null;
      const modifierSelection =
        item?.modifierSelection ?? ((modifierSelect?.value ?? "auto") as GlyphModifierSelection);
      const detectedModifier =
        item?.detectedModifier ??
        ((select.dataset.detectedModifier || null) as KanaModifier | null);
      const modifierConfidence =
        item?.modifierConfidence ?? Number(select.dataset.modifierConfidence ?? 0);
      const supportedDetectedModifier =
        detectedModifier && getSupportedModifiers(select.value).includes(detectedModifier)
          ? detectedModifier
          : null;
      const modifier = resolveGlyphModifier(
        modifierSelection,
        supportedDetectedModifier,
        modifierConfidence,
      );
      const sizeSelect = segmentIndex
        ? multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-size-index="${segmentIndex}"]`,
          )
        : null;
      const automaticSize =
        item?.automaticSize ?? ((select.dataset.automaticSize ?? "normal") as GlyphSize);
      const sizeSelection =
        item?.sizeSelection ?? ((sizeSelect?.value ?? "auto") as GlyphSizeSelection);
      const output = resolveGlyphOutput(
        item?.selectedBaseKana ?? select.value,
        sizeSelection,
        automaticSize,
        modifier,
      );
      const outputPreview = segmentIndex
        ? multiCandidateGrid.querySelector<HTMLElement>(`[data-output-index="${segmentIndex}"]`)
        : null;
      if (outputPreview) outputPreview.textContent = output.kana;
      if (item && segmentIndex) refreshRecognitionReview(Number(segmentIndex), item);
      values.push(output.kana);
      lineValues.set(lineIndex, values);
    });
  multiText.textContent = [...lineValues.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, values]) => values.join(""))
    .join("\n");
  copyMultiText.disabled = !(multiText.textContent ?? "").trim();
  copyMultiStatus.textContent = "";
  syncGroundTruthFromRecognition();
  renderLabelEvaluation();
  updateStoredEvaluation();
}

async function copyRecognizedText(): Promise<void> {
  const text = multiText.textContent ?? "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    copyMultiStatus.textContent = "コピーしました";
    copyMultiStatus.dataset.state = "success";
  } catch {
    copyMultiStatus.textContent = "コピーできませんでした。ブラウザの権限を確認してください。";
    copyMultiStatus.dataset.state = "error";
  }
}

function refreshMultiSizeOptions(baseSelect: HTMLSelectElement): void {
  const segmentIndex = baseSelect.dataset.segmentIndex;
  if (!segmentIndex) return;
  const sizeSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
    `select[data-size-index="${segmentIndex}"]`,
  );
  if (!sizeSelect) return;
  const automaticSize = (baseSelect.dataset.automaticSize ?? "normal") as GlyphSize;
  const selection = coerceGlyphSizeSelection(
    baseSelect.value,
    sizeSelect.value as GlyphSizeSelection,
  );
  const choices = buildGlyphSizeChoices(baseSelect.value, automaticSize, selection);
  for (const choice of choices) {
    const option = sizeSelect.querySelector<HTMLOptionElement>(`option[value="${choice.value}"]`);
    if (!option) continue;
    option.textContent = choice.label;
    option.disabled = choice.disabled;
  }
  sizeSelect.value = choices.find((choice) => choice.selected)?.value ?? "auto";
}

function refreshMultiModifierOptions(baseSelect: HTMLSelectElement): void {
  const segmentIndex = baseSelect.dataset.segmentIndex;
  if (!segmentIndex) return;
  const modifierSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
    `select[data-modifier-index="${segmentIndex}"]`,
  );
  if (!modifierSelect) return;
  const detectedModifier = (baseSelect.dataset.detectedModifier || null) as KanaModifier | null;
  const modifierConfidence = Number(baseSelect.dataset.modifierConfidence ?? 0);
  const selection = coerceGlyphModifierSelection(
    baseSelect.value,
    modifierSelect.value as GlyphModifierSelection,
  );
  const choices = buildGlyphModifierChoices(
    baseSelect.value,
    detectedModifier,
    modifierConfidence,
    selection,
  );
  for (const choice of choices) {
    const option = modifierSelect.querySelector<HTMLOptionElement>(
      `option[value="${choice.value}"]`,
    );
    if (!option) continue;
    option.textContent = choice.label;
    option.disabled = choice.disabled;
  }
  modifierSelect.value = choices.find((choice) => choice.selected)?.value ?? "auto";
}

function renderLabelEvaluation(): void {
  if (!groundTruthInput.value.trim()) {
    labelCharacterAccuracy.textContent = "--";
    labelLineAccuracy.textContent = "--";
    labelExactMatch.textContent = "--";
    groundTruthStatus.textContent = "正解ラベルを入力すると評価します。";
    delete groundTruthStatus.dataset.state;
    return;
  }

  const evaluation = evaluateTranscription(multiText.textContent ?? "", groundTruthInput.value);
  labelCharacterAccuracy.textContent = `${(evaluation.characterAccuracy * 100).toFixed(1)}%`;
  labelLineAccuracy.textContent = `${(evaluation.exactLineRate * 100).toFixed(1)}%`;
  labelExactMatch.textContent = evaluation.exactMatch ? "一致" : "不一致";
  if (groundTruthAutoLinked) {
    groundTruthStatus.textContent =
      "認識結果を仮入力し、候補修正を自動反映しています。内容を確認して保存してください。";
    groundTruthStatus.dataset.state = "warning";
  } else {
    groundTruthStatus.textContent = evaluation.exactMatch
      ? `${evaluation.expectedCharacters}文字が全文一致しました。`
      : `編集距離 ${evaluation.editDistance} · 正解 ${evaluation.expectedCharacters}文字`;
    groundTruthStatus.dataset.state = evaluation.exactMatch ? "success" : "warning";
  }
}

function saveCurrentGroundTruth(): void {
  if (!selectedImageFile) return;
  try {
    const key = groundTruthStorageKey(selectedImageFile);
    if (groundTruthInput.value.trim()) localStorage.setItem(key, groundTruthInput.value);
    else localStorage.removeItem(key);
    groundTruthAutoLinked = false;
    groundTruthInput.dataset.source = "saved";
    groundTruthStatus.textContent = groundTruthInput.value.trim()
      ? "この画像の正解ラベルをブラウザ内へ保存しました。"
      : "この画像の正解ラベルを削除しました。";
    groundTruthStatus.dataset.state = "success";
    updateStoredEvaluation();
  } catch {
    groundTruthStatus.textContent = "ブラウザ内へ正解ラベルを保存できませんでした。";
    groundTruthStatus.dataset.state = "warning";
  }
}

async function recognizeSelectedMultipleGlyphs(): Promise<void> {
  if (!selectedImageFile || loadedGlyphTemplates.length === 0) return;

  activeRecognitionController?.abort();
  const recognitionController = new AbortController();
  activeRecognitionController = recognitionController;
  const recognitionFile = selectedImageFile;
  const recognitionCrop = selectedCrop ? { ...selectedCrop } : null;

  recognizeMultiple.disabled = true;
  recognizeMultiple.textContent = "抽出中…";
  multiResult.hidden = false;
  multiStatus.textContent = "背景ノイズを除去して文字候補を探しています。";
  multiStatus.dataset.state = "loading";
  currentRecognizedGlyphs = [];
  multiCandidateGrid.innerHTML = "";
  multiText.textContent = "";
  copyMultiText.disabled = true;
  copyMultiStatus.textContent = "";
  useRecognizedText.disabled = true;

  try {
    const variants = await loadImageAsBinaryGlyphVariants(recognitionFile, recognitionCrop);
    if (recognitionController.signal.aborted) return;
    multiStatus.textContent = "文字候補をバックグラウンドで照合しています。";
    const { attempts, selected: selectedAttempt } = await recognizeInWorker(
      variants,
      loadedGlyphTemplates,
      binarizationMode.value as "auto" | (typeof variants)[number]["mode"],
      recognitionController.signal,
    );
    if (recognitionController.signal.aborted) return;
    if (!selectedAttempt) {
      throw new Error(
        "文字候補を検出できませんでした。白または単純な背景の範囲へ切り抜いてください。",
      );
    }
    const { recognized } = selectedAttempt;
    currentRecognizedGlyphs = recognized;

    multiCandidateGrid.innerHTML = recognized
      .map((item, index) => {
        const topKana = item.candidates[0]?.kana ?? "";
        const sizeChoices = buildGlyphSizeChoices(topKana, item.automaticSize);
        const modifierChoices = buildGlyphModifierChoices(
          topKana,
          item.detectedModifier,
          item.modifierConfidence,
          item.modifierSelection,
        );
        return `
          <article class="multi-candidate-card" data-result-index="${index}" data-source-x="${item.bbox.x}" data-source-y="${item.bbox.y}" data-source-width="${item.bbox.width}" data-source-height="${item.bbox.height}">
            <canvas data-segment-preview="${index}" aria-label="${index + 1}番目の文字候補"></canvas>
            <span class="multi-order">${index + 1}</span>
            <span class="recognition-review-badge" data-review-index="${index}" aria-live="polite"></span>
            <label>
              認識候補
              <select data-line-index="${item.lineIndex}" data-segment-index="${index}" data-automatic-size="${item.automaticSize}" data-detected-modifier="${item.detectedModifier ?? ""}" data-modifier-confidence="${item.modifierConfidence}" aria-label="${index + 1}番目の認識候補">
                ${(() => {
                  const choices = buildCorrectionChoices(item.candidates, horizontalGlyphs);
                  return `
                    <optgroup label="上位候補">
                      ${choices.topCandidates
                        .map((choice) => {
                          const small =
                            item.automaticSize === "small" ? composeSmallKana(choice.kana) : null;
                          const label = small?.ok
                            ? `${small.kana}（${choice.kana}の小書き）`
                            : choice.kana;
                          return `<option value="${choice.kana}">${label} · ${((choice.score ?? 0) * 100).toFixed(1)}%</option>`;
                        })
                        .join("")}
                    </optgroup>
                    <optgroup label="その他の文字">
                      ${choices.otherGlyphs
                        .map((choice) => `<option value="${choice.kana}">${choice.kana}</option>`)
                        .join("")}
                    </optgroup>
                  `;
                })()}
              </select>
              <button class="base-auto-reset" data-base-auto-index="${index}" type="button" disabled>自動候補へ戻す</button>
            </label>
            <label>
              文字サイズ
              <select data-size-index="${index}" aria-label="${index + 1}番目の文字サイズ">
                ${sizeChoices
                  .map(
                    (choice) =>
                      `<option value="${choice.value}"${choice.selected ? " selected" : ""}${choice.disabled ? " disabled" : ""}>${choice.label}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label>
              修飾記号
              <select data-modifier-index="${index}" aria-label="${index + 1}番目の修飾記号">
                ${modifierChoices
                  .map(
                    (choice) =>
                      `<option value="${choice.value}"${choice.selected ? " selected" : ""}${choice.disabled ? " disabled" : ""}>${choice.label}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <span class="multi-resolved-output">出力: <strong data-output-index="${index}">${topKana}</strong></span>
          </article>
        `;
      })
      .join("");

    recognized.forEach((item, index) => {
      const canvas = multiCandidateGrid.querySelector<HTMLCanvasElement>(
        `[data-segment-preview="${index}"]`,
      );
      if (canvas) drawBinaryGlyph(canvas, item.binary, 2);
    });
    multiCandidateGrid
      .querySelectorAll<HTMLSelectElement>("select[data-line-index]")
      .forEach((select) => {
        refreshMultiSizeOptions(select);
        refreshMultiModifierOptions(select);
        select.addEventListener("change", () => {
          refreshMultiSizeOptions(select);
          refreshMultiModifierOptions(select);
          const item = recognized[Number(select.dataset.segmentIndex)];
          const sizeSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-size-index="${select.dataset.segmentIndex}"]`,
          );
          const modifierSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-modifier-index="${select.dataset.segmentIndex}"]`,
          );
          if (item) {
            item.selectedBaseKana = select.value;
            item.baseSelection = "manual";
            item.sizeSelection = (sizeSelect?.value ?? "auto") as GlyphSizeSelection;
            item.modifierSelection = (modifierSelect?.value ?? "auto") as GlyphModifierSelection;
          }
          const resetButton = multiCandidateGrid.querySelector<HTMLButtonElement>(
            `button[data-base-auto-index="${select.dataset.segmentIndex}"]`,
          );
          if (resetButton) resetButton.disabled = false;
          updateMultiText();
        });
      });
    multiCandidateGrid
      .querySelectorAll<HTMLButtonElement>("button[data-base-auto-index]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const index = Number(button.dataset.baseAutoIndex);
          const item = recognized[index];
          const baseSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-segment-index="${index}"]`,
          );
          if (!item || !baseSelect) return;
          item.selectedBaseKana = item.automaticBaseKana;
          item.baseSelection = "auto";
          baseSelect.value = item.automaticBaseKana;
          refreshMultiSizeOptions(baseSelect);
          refreshMultiModifierOptions(baseSelect);
          const sizeSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-size-index="${index}"]`,
          );
          const modifierSelect = multiCandidateGrid.querySelector<HTMLSelectElement>(
            `select[data-modifier-index="${index}"]`,
          );
          item.sizeSelection = (sizeSelect?.value ?? "auto") as GlyphSizeSelection;
          item.modifierSelection = (modifierSelect?.value ?? "auto") as GlyphModifierSelection;
          button.disabled = true;
          updateMultiText();
        }),
      );
    multiCandidateGrid
      .querySelectorAll<HTMLSelectElement>("select[data-size-index]")
      .forEach((select) =>
        select.addEventListener("change", () => {
          const item = recognized[Number(select.dataset.sizeIndex)];
          if (item) item.sizeSelection = select.value as GlyphSizeSelection;
          updateMultiText();
        }),
      );
    multiCandidateGrid
      .querySelectorAll<HTMLSelectElement>("select[data-modifier-index]")
      .forEach((select) =>
        select.addEventListener("change", () => {
          const item = recognized[Number(select.dataset.modifierIndex)];
          if (item) item.modifierSelection = select.value as GlyphModifierSelection;
          updateMultiText();
        }),
      );
    updateMultiText();
    const modeDescription =
      binarizationMode.value === "auto"
        ? `${selectedAttempt.label}を自動選択`
        : `${selectedAttempt.label}で処理`;
    const attemptSummary = attempts
      .map((attempt) => {
        const refinedCount = attempt.refinedCandidateCount;
        const count =
          attempt.initialCandidateCount === refinedCount
            ? `${refinedCount}字`
            : `${attempt.initialCandidateCount}→${refinedCount}字`;
        return `${attempt.label} ${count}`;
      })
      .join(" / ");
    const modifierCount = recognized.filter(
      (item) =>
        item.detectedModifier &&
        item.modifierConfidence >= 0.7 &&
        getSupportedModifiers(item.candidates[0]?.kana ?? "").includes(item.detectedModifier),
    ).length;
    const smallCount = recognized.filter((item) => item.automaticSize === "small").length;
    const automaticSummary = [
      modifierCount ? `修飾記号 ${modifierCount}件` : "",
      smallCount ? `小書き ${smallCount}件` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    multiStatus.textContent = `${modeDescription} · ${selectedAttempt.lineCount}行・${selectedAttempt.refinedCandidateCount}文字候補を抽出しました。${automaticSummary ? `${automaticSummary}を自動判定。` : ""}比較: ${attemptSummary}`;
    multiStatus.dataset.state = "success";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    multiStatus.textContent =
      error instanceof Error ? error.message : "複数文字画像を処理できませんでした。";
    multiStatus.dataset.state = "error";
  } finally {
    if (activeRecognitionController === recognitionController) activeRecognitionController = null;
    recognizeMultiple.textContent = "複数文字を認識";
    updateSingleRecognitionAvailability();
  }
}

async function initializeGlyphTemplates(): Promise<void> {
  try {
    loadedGlyphTemplates = await Promise.all(horizontalGlyphs.map(loadGlyphTemplate));
    for (const template of loadedGlyphTemplates) {
      const featureLabel = getRequiredElement<HTMLElement>(
        `#glyph-feature-${template.definition.id}`,
      );
      featureLabel.textContent = `前景 ${(template.features.foregroundRatio * 100).toFixed(1)}%`;
    }
    templateStatus.textContent = `基本${loadedGlyphTemplates.length}字の64×64特徴量を生成しました。`;
    templateStatus.dataset.state = "success";
    rankingInput.disabled = false;
    rankingRun.disabled = false;
    robustnessRun.disabled = false;
    updateSingleRecognitionAvailability();
    renderCandidateRanking();
    runRobustnessEvaluation();
    renderSmallKanaComposition();
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    templateStatus.textContent = message;
    templateStatus.dataset.state = "error";
  }
}

rankingRun.addEventListener("click", renderCandidateRanking);
rankingInput.addEventListener("change", renderCandidateRanking);
recognizeSingle.addEventListener("click", () => void recognizeSelectedSingleGlyph());
recognizeMultiple.addEventListener("click", () => void recognizeSelectedMultipleGlyphs());
robustnessRun.addEventListener("click", runRobustnessEvaluation);
modifierBase.addEventListener("change", renderKanaComposition);
modifierKind.addEventListener("change", renderKanaComposition);
smallFormBase.addEventListener("change", renderSmallKanaComposition);
groundTruthInput.addEventListener("input", () => {
  groundTruthAutoLinked = false;
  groundTruthInput.dataset.source = "manual";
  renderLabelEvaluation();
});
copyMultiText.addEventListener("click", () => void copyRecognizedText());
useRecognizedText.addEventListener("click", () => {
  syncGroundTruthFromRecognition(true);
  renderLabelEvaluation();
});
saveGroundTruth.addEventListener("click", saveCurrentGroundTruth);
renderKanaComposition();
renderEvaluationSummary();
void initializeGlyphTemplates();
