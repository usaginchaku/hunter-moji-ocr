import "./styles.css";
import {
  ACCEPTED_IMAGE_TYPES,
  formatFileSize,
  MAX_IMAGE_BYTES,
  validateImageFile,
  validateImageDimensions,
} from "./app/file-validation";
import {
  composeKana,
  getSupportedModifiers,
  KANA_MODIFIER_LABELS,
  type KanaModifier,
} from "./domain/kana-composition";
import { composeSmallKana, SMALL_KANA_BASES } from "./domain/small-kana";
import { assessRecognitionReview, recognitionReviewLabel } from "./domain/recognition-review";
import { ReadingSession } from "./domain/reading-session";
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
        <h1>ハンター文字 <span>OCR</span></h1>
      </div>
      <a class="generator-link" href="${import.meta.env.BASE_URL}generator.html">画像メーカー</a>
    </header>

    <section class="workspace" aria-labelledby="upload-heading">
      <div class="section-heading">
        <div>
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
          <label for="crop-tool">操作 <select id="crop-tool"><option value="select">範囲を選ぶ</option><option value="pan">画像を動かす</option></select></label>
          <span>緑の枠内を読み取ります。</span>
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

      <section class="multi-glyph-panel" aria-labelledby="multi-glyph-heading">
        <div>
          <h3 id="multi-glyph-heading">読み取り</h3>
        </div>
        <div class="multi-recognition-actions">
          <details class="processing-options"><summary>背景処理</summary><label for="binarization-mode">
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
          </details>
          <button id="recognize-multiple" type="button" disabled>読み取る</button>
          <button id="cancel-recognition" type="button" hidden>中止</button>
        </div>
        <p id="multi-status" class="single-status" role="status"></p>
        <div id="pending-result" class="pending-result" hidden>
          <p id="pending-message" role="status"></p>
          <button id="accept-result" type="button">新しい結果に切り替え</button>
          <button id="keep-result" type="button">今の編集を続ける</button>
        </div>
        <div class="multi-result" hidden>
          <details class="result-image"><summary id="result-source"></summary><img id="result-source-image" alt="この認識結果の元画像" /></details>
          <div class="multi-summary">
            <label for="multi-text">文章を確認・編集</label>
            <textarea id="multi-text" rows="4" aria-describedby="text-review-status" spellcheck="false"></textarea>
            <span id="text-review-status" role="status"></span>
            <div class="multi-output-actions">
              <button id="copy-multi-text" type="button" disabled>コピー</button>
              <button id="confirm-text" type="button">文章を確認済みにする</button>
              <button id="restore-result" type="button" hidden>直前の結果に戻る</button>
              <span id="copy-multi-status" role="status"></span>
            </div>
          </div>
          <details class="result-details" id="correction-details"><summary>文字ごとの候補を確認・修正</summary>
            <p>得点は字形の類似度です。正しい確率ではありません。</p>
            <div id="candidate-text-notice" hidden><p>文章は手編集を保持しています。候補の変更は自動では反映されません。</p><button id="use-candidate-text" type="button">候補の文章に置き換える</button></div>
            <div id="multi-candidate-grid" class="multi-candidate-grid"></div>
          </details>
          <details class="result-details"><summary>自動認識の原文・処理情報</summary><pre id="automatic-text"></pre><p id="recognition-details"></p></details>
          <details class="result-details" id="evaluation-details"><summary>正解を登録して評価</summary>
          <section class="ground-truth-panel" aria-labelledby="ground-truth-heading">
            <div>
              <h4 id="ground-truth-heading">正解ラベル</h4>
              <p>自動認識の原文と、確定した正解を比較します。保存はこのブラウザ内だけで、認識の学習には使いません。</p>
            </div>
            <label for="ground-truth-input">正解文字列</label>
            <textarea id="ground-truth-input" rows="3" placeholder="例：ざんぎょう\nちゅうです"></textarea>
            <div class="ground-truth-actions">
              <button id="use-recognized-text" type="button" disabled>編集中の文章を下書きへ</button>
              <button id="save-ground-truth" type="button">正解として確定・保存</button>
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
              <p class="ground-truth-status">端末内の旧評価を含む累計です。Top-1／Top-3・濁点等は文字数が一致した画像のみの候補評価です。</p>
            </div>
          </section></details>
        </div>
      </section>
    </section>

    <details class="utility-details" id="diagnostics"><summary>検証ツール</summary>
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

    </details>
    <details class="utility-details" id="about"><summary>使い方・このツールについて</summary>
      <p>横書き・単純な背景・鮮明な印刷文字が対象です。画像を選び、必要なら範囲を囲んで「読み取る」を押してください。結果は原画像と見比べ、文章を直してコピーできます。</p>
      <p>PNG・JPEG・WebP、最大20 MB。画像は端末内で処理し、外部へ送信しません。複雑な背景や手書き、縦書きには対応していません。</p>
      <p>再認識中も文章は編集できます。手修正があるときは、新しい結果へ切り替えるか選べます。結果と編集はこのページ内で保持し、ページを閉じると失われます。</p>
      <p>非公式ファンツールです。作品および権利者とは関係ありません。</p>
    </details>
    <footer>
      <p>非公式ファンツールです。作品および権利者とは関係ありません。</p>
      <p>試験版</p>
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
const multiText = getRequiredElement<HTMLTextAreaElement>("#multi-text");
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
interface ReadingSource {
  file: File;
  crop: NormalizedCrop | null;
  recognized: RuntimeRecognizedGlyph[];
  summary: string;
  details: string;
}
const readingSession = new ReadingSession<ReadingSource>();
const cancelRecognition = getRequiredElement<HTMLButtonElement>("#cancel-recognition");
const pendingResult = getRequiredElement<HTMLElement>("#pending-result");
const pendingMessage = getRequiredElement<HTMLElement>("#pending-message");
const resultSource = getRequiredElement<HTMLElement>("#result-source");
const resultSourceImage = getRequiredElement<HTMLImageElement>("#result-source-image");
const textReviewStatus = getRequiredElement<HTMLElement>("#text-review-status");
const confirmText = getRequiredElement<HTMLButtonElement>("#confirm-text");
const restoreResult = getRequiredElement<HTMLButtonElement>("#restore-result");
const candidateTextNotice = getRequiredElement<HTMLElement>("#candidate-text-notice");
const cropTool = getRequiredElement<HTMLSelectElement>("#crop-tool");
let resultPreviewUrl: string | null = null;
let imageSelectionRevision = 0;
let imageLoading = false;
let lastCropWheelZoomAt = Number.NEGATIVE_INFINITY;
const MIN_CROP_ZOOM = 1;
const MAX_CROP_ZOOM = 4;
const CROP_ZOOM_STEP = 0.25;
const EVALUATION_STORAGE_KEY = "hunter-moji-ocr:evaluation-records:v1";

function groundTruthStorageKey(file: File, crop: NormalizedCrop | null = null): string {
  const legacy = `hunter-moji-ocr:ground-truth:${file.name}:${file.size}:${file.lastModified}`;
  return crop ? `${legacy}:crop:${JSON.stringify(crop)}` : legacy;
}

function loadGroundTruth(file: File, crop: NormalizedCrop | null): string {
  try {
    return localStorage.getItem(groundTruthStorageKey(file, crop)) ?? "";
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

function automaticRecognitionEvaluationData(glyphs = currentRecognizedGlyphs): {
  predicted: string;
  topCandidates: string[][];
} | null {
  if (glyphs.length === 0) return null;
  const lines = new Map<number, string[]>();
  const topCandidates: string[][] = [];
  for (const item of glyphs) {
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
  const result = readingSession.current;
  if (!result || result.confirmedExpected === null) return;
  const records = loadEvaluationRecords();
  const key = groundTruthStorageKey(result.source.file, result.source.crop);
  const expected = result.confirmedExpected.trim();
  if (!expected) {
    delete records[key];
  } else {
    const automatic = automaticRecognitionEvaluationData();
    const evaluation = evaluateTranscription(result.automaticText, expected);
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
  const busy = activeRecognitionController !== null || imageLoading;
  const unavailable = selectedImageFile === null || loadedGlyphTemplates.length === 0 || busy;
  recognizeSingle.disabled = unavailable;
  recognizeMultiple.disabled = unavailable;
  recognizeMultiple.textContent = activeRecognitionController ? "読み取り中…" : "読み取る";
  cancelRecognition.hidden = !busy;
}

function cancelCurrentWork(message?: string): void {
  activeRecognitionController?.abort();
  activeRecognitionController = null;
  imageSelectionRevision += 1;
  imageLoading = false;
  readingSession.cancel();
  if (message) {
    multiStatus.textContent = message;
    multiStatus.dataset.state = "cancelled";
  }
  updateSingleRecognitionAvailability();
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
  cancelCurrentWork("範囲を変更しました。表示中の結果と編集は前回の読み取りを保持しています。");
  normalizedResult.hidden = true;
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

async function showImage(file: File): Promise<void> {
  const selection = ++imageSelectionRevision;
  const validation = validateImageFile(file);
  if (!validation.ok) {
    imageLoading = false;
    fileMessage.textContent = validation.message;
    fileMessage.dataset.state = "error";
    input.value = "";
    updateSingleRecognitionAvailability();
    return;
  }
  activeRecognitionController?.abort();
  activeRecognitionController = null;
  readingSession.cancel();
  imageLoading = true;
  updateSingleRecognitionAvailability();
  fileMessage.textContent = "画像を読み込んでいます。";
  const nextUrl = URL.createObjectURL(file);
  let committed = false;
  try {
    const image = new Image();
    image.src = nextUrl;
    await image.decode();
    const dimensions = validateImageDimensions(image.naturalWidth, image.naturalHeight);
    if (!dimensions.ok) throw new Error(dimensions.message);
    if (selection !== imageSelectionRevision) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = nextUrl;
    committed = true;
    previewImage.src = nextUrl;
    previewCaption.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    preview.hidden = false;
    normalizedResult.hidden = true;
    selectedImageFile = file;
    selectedCrop = null;
    cropDragStart = null;
    cropPanStart = null;
    delete cropStage.dataset.panning;
    cropZoom = MIN_CROP_ZOOM;
    renderCropZoom();
    renderCropSelection();
    fileMessage.textContent = "画像を選択しました。必要なら範囲を囲んでください。";
    fileMessage.dataset.state = "success";
    multiStatus.textContent = readingSession.current
      ? "画像を切り替えました。下の結果は表示された元画像の読み取りです。"
      : "";
    delete multiStatus.dataset.state;
  } catch (error) {
    if (selection !== imageSelectionRevision) return;
    fileMessage.textContent =
      error instanceof Error && error.message.includes("上限")
        ? error.message
        : "画像を読み込めませんでした。別のPNG・JPEG・WebPを選んでください。前の画像と編集は保持しています。";
    fileMessage.dataset.state = "error";
    input.value = "";
  } finally {
    if (!committed) URL.revokeObjectURL(nextUrl);
    if (selection === imageSelectionRevision) {
      imageLoading = false;
      updateSingleRecognitionAvailability();
    }
  }
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) void showImage(file);
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
  if (file) void showImage(file);
});

cropStage.addEventListener("pointerdown", (event) => {
  if (!selectedImageFile || (event.button !== 0 && event.button !== 2)) return;
  event.preventDefault();
  cropStage.setPointerCapture(event.pointerId);
  if (event.button === 2 || cropTool.value === "pan") {
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
  if (cropDragStart) selectedCrop = cropBeforeDrag;
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
  if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
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
  if (
    !selectedImageFile ||
    loadedGlyphTemplates.length === 0 ||
    activeRecognitionController ||
    imageLoading
  )
    return;
  const ticket = readingSession.begin();
  const controller = new AbortController();
  activeRecognitionController = controller;
  const file = selectedImageFile;
  const crop = selectedCrop ? { ...selectedCrop } : null;
  updateSingleRecognitionAvailability();

  recognizeSingle.disabled = true;
  recognizeSingle.textContent = "照合中…";
  normalizedResult.hidden = false;
  singleStatus.textContent = "画像を二値化しています。";
  singleStatus.dataset.state = "loading";
  singleCandidateResults.innerHTML = "";

  try {
    const source = await loadImageAsBinaryGlyph(file, crop);
    if (controller.signal.aborted || !readingSession.isCurrentRequest(ticket)) return;
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
    if (controller.signal.aborted || !readingSession.isCurrentRequest(ticket)) return;
    const message = error instanceof Error ? error.message : "画像を処理できませんでした。";
    singleStatus.textContent = message;
    singleStatus.dataset.state = "error";
  } finally {
    recognizeSingle.textContent = "この画像を照合";
    if (activeRecognitionController === controller) {
      activeRecognitionController = null;
      updateSingleRecognitionAvailability();
    }
  }
}

function copyTextToExpectedDraft(): void {
  readingSession.setExpectedDraft(readingSession.current?.text ?? "");
  groundTruthInput.value = readingSession.current?.expectedDraft ?? "";
  groundTruthInput.dataset.source = "draft";
  renderLabelEvaluation();
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
  badge.textContent = recognitionReviewLabel(
    assessment,
    item.baseSelection === "manual" ||
      item.sizeSelection !== "auto" ||
      item.modifierSelection !== "auto",
  );
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
  const candidateText = [...lineValues.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, values]) => values.join(""))
    .join("\n");
  readingSession.updateCandidates(
    candidateText,
    currentRecognizedGlyphs.some(
      (item) =>
        item.baseSelection === "manual" ||
        item.sizeSelection !== "auto" ||
        item.modifierSelection !== "auto",
    ),
  );
  renderEditedText();
}

async function copyRecognizedText(): Promise<void> {
  const text = readingSession.current?.text ?? "";
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    copyMultiStatus.textContent = "コピーしました";
    copyMultiStatus.dataset.state = "success";
  } catch {
    multiText.focus();
    multiText.select();
    copyMultiStatus.textContent =
      "コピーできませんでした。選択した文章を手動でコピーしてください。";
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
  const result = readingSession.current;
  if (!result || result.confirmedExpected === null) {
    labelCharacterAccuracy.textContent = "--";
    labelLineAccuracy.textContent = "--";
    labelExactMatch.textContent = "--";
    groundTruthStatus.textContent =
      "正解は未確定です。内容を確認して「正解として確定・保存」を押すと評価します。";
    delete groundTruthStatus.dataset.state;
    return;
  }
  const evaluation = evaluateTranscription(result.automaticText, result.confirmedExpected);
  labelCharacterAccuracy.textContent = `${(evaluation.characterAccuracy * 100).toFixed(1)}%`;
  labelLineAccuracy.textContent = `${(evaluation.exactLineRate * 100).toFixed(1)}%`;
  labelExactMatch.textContent = evaluation.exactMatch ? "一致" : "不一致";
  groundTruthStatus.textContent = `確定正解と自動認識の原文を比較しています。編集距離 ${evaluation.editDistance} · 正解 ${evaluation.expectedCharacters}文字`;
  groundTruthStatus.dataset.state = evaluation.exactMatch ? "success" : "warning";
}

function saveCurrentGroundTruth(): void {
  const result = readingSession.current;
  if (!result) return;
  try {
    const key = groundTruthStorageKey(result.source.file, result.source.crop);
    if (result.expectedDraft.trim()) localStorage.setItem(key, result.expectedDraft);
    else localStorage.removeItem(key);
    readingSession.confirmExpected();
    groundTruthInput.dataset.source = result.confirmedExpected === null ? "draft" : "saved";
    if (result.confirmedExpected === null) {
      const records = loadEvaluationRecords();
      delete records[key];
      localStorage.setItem(EVALUATION_STORAGE_KEY, JSON.stringify(records));
      renderEvaluationSummary();
    } else updateStoredEvaluation();
    renderLabelEvaluation();
  } catch {
    groundTruthStatus.textContent = "正解を保存できませんでした。入力した下書きは保持しています。";
    groundTruthStatus.dataset.state = "warning";
  }
}

function renderRecognizedCards(recognized: RuntimeRecognizedGlyph[]): void {
  multiCandidateGrid.innerHTML = recognized
    .map((item, index) => {
      const topKana = item.selectedBaseKana;
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
  recognized.forEach((item, index) => {
    const base = multiCandidateGrid.querySelector<HTMLSelectElement>(
      `select[data-segment-index="${index}"]`,
    );
    const size = multiCandidateGrid.querySelector<HTMLSelectElement>(
      `select[data-size-index="${index}"]`,
    );
    const modifier = multiCandidateGrid.querySelector<HTMLSelectElement>(
      `select[data-modifier-index="${index}"]`,
    );
    const reset = multiCandidateGrid.querySelector<HTMLButtonElement>(
      `button[data-base-auto-index="${index}"]`,
    );
    if (base) base.value = item.selectedBaseKana;
    if (size) size.value = item.sizeSelection;
    if (modifier) modifier.value = item.modifierSelection;
    if (reset) reset.disabled = item.baseSelection === "auto";
    refreshRecognitionReview(index, item);
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
}

function renderEditedText(): void {
  const result = readingSession.current;
  if (!result) return;
  if (multiText.value !== result.text) multiText.value = result.text;
  copyMultiText.disabled = !result.text.trim();
  useRecognizedText.disabled = !result.text.trim();
  confirmText.disabled = !result.text.trim() || result.reviewed;
  candidateTextNotice.hidden = !result.textEdited;
  textReviewStatus.textContent = result.reviewed
    ? "本人確認済み"
    : result.textEdited || result.candidatesEdited
      ? "手動修正あり・未確認"
      : "自動候補・未確認";
  copyMultiStatus.textContent = "";
}

function renderCurrentResult(): void {
  const result = readingSession.current;
  multiResult.hidden = !result;
  pendingResult.hidden = !readingSession.pending;
  if (readingSession.pending)
    pendingMessage.textContent = `「${readingSession.pending.source.file.name}」の新しい結果ができました。現在の編集を保持しています。`;
  restoreResult.hidden = !readingSession.previous;
  if (!result) return;
  currentRecognizedGlyphs = result.source.recognized;
  const crop = result.source.crop;
  const range = crop
    ? `範囲 x${Math.round(crop.x * 100)}% y${Math.round(crop.y * 100)}% 幅${Math.round(crop.width * 100)}% 高さ${Math.round(crop.height * 100)}%`
    : "画像全体";
  resultSource.textContent = `結果の元画像: ${result.source.file.name}（${range}）`;
  if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);
  resultPreviewUrl = URL.createObjectURL(result.source.file);
  resultSourceImage.src = resultPreviewUrl;
  getRequiredElement<HTMLElement>("#automatic-text").textContent = result.automaticText;
  getRequiredElement<HTMLElement>("#recognition-details").textContent = result.source.details;
  groundTruthInput.value = result.expectedDraft;
  groundTruthInput.dataset.source = result.confirmedExpected === null ? "draft" : "saved";
  renderRecognizedCards(result.source.recognized);
  renderEditedText();
  renderLabelEvaluation();
}

async function recognizeSelectedMultipleGlyphs(): Promise<void> {
  if (
    !selectedImageFile ||
    loadedGlyphTemplates.length === 0 ||
    imageLoading ||
    activeRecognitionController
  )
    return;
  const ticket = readingSession.begin();
  const recognitionController = new AbortController();
  activeRecognitionController = recognitionController;
  const recognitionFile = selectedImageFile;
  const recognitionCrop = selectedCrop ? { ...selectedCrop } : null;
  const mode = binarizationMode.value;
  const started = performance.now();
  let phase = "画像を処理しています";
  const updateProgress = (): void => {
    if (readingSession.isCurrentRequest(ticket))
      multiStatus.textContent = `${phase} · ${Math.floor((performance.now() - started) / 1000)}秒`;
  };
  multiStatus.dataset.state = "loading";
  updateProgress();
  updateSingleRecognitionAvailability();
  const timer = window.setInterval(updateProgress, 1000);
  try {
    const variants = await loadImageAsBinaryGlyphVariants(recognitionFile, recognitionCrop);
    if (recognitionController.signal.aborted || !readingSession.isCurrentRequest(ticket)) return;
    phase = "文字を照合しています";
    const { attempts, selected } = await recognizeInWorker(
      variants,
      loadedGlyphTemplates,
      mode as "auto" | (typeof variants)[number]["mode"],
      recognitionController.signal,
    );
    if (recognitionController.signal.aborted || !readingSession.isCurrentRequest(ticket)) return;
    if (!selected || !selected.recognized.length)
      throw new Error(
        "文字を検出できませんでした。文字の範囲を狭めて試してください。前の結果と編集は保持しています。",
      );
    const automatic = automaticRecognitionEvaluationData(selected.recognized)!;
    const summary = `${selected.lineCount}行・${selected.refinedCandidateCount}文字を読み取りました。`;
    const details = `${selected.label} · ${mode === "auto" ? "自動選択" : "手動選択"}。比較: ${attempts.map((attempt) => `${attempt.label} ${attempt.initialCandidateCount}→${attempt.refinedCandidateCount}文字`).join(" / ")}`;
    readingSession.complete(
      ticket,
      {
        file: recognitionFile,
        crop: recognitionCrop,
        recognized: selected.recognized,
        summary,
        details,
      },
      automatic.predicted,
      loadGroundTruth(recognitionFile, recognitionCrop),
    );
    renderCurrentResult();
    updateStoredEvaluation();
    multiStatus.textContent = readingSession.pending
      ? "新しい認識結果を用意しました。編集中の文章はそのままです。"
      : summary;
    multiStatus.dataset.state = "success";
  } catch (error) {
    if (!readingSession.isCurrentRequest(ticket) || recognitionController.signal.aborted) return;
    multiStatus.textContent =
      error instanceof Error
        ? error.message
        : "認識できませんでした。前の結果と編集は保持しています。";
    multiStatus.dataset.state = "error";
  } finally {
    window.clearInterval(timer);
    if (activeRecognitionController === recognitionController) {
      activeRecognitionController = null;
      updateSingleRecognitionAvailability();
    }
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
    evaluationStatus.textContent = "「再評価」で内部検査を実行します。";
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
  readingSession.setExpectedDraft(groundTruthInput.value);
  groundTruthInput.dataset.source = "draft";
  renderLabelEvaluation();
});
copyMultiText.addEventListener("click", () => void copyRecognizedText());
useRecognizedText.addEventListener("click", copyTextToExpectedDraft);
multiText.addEventListener("input", () => {
  readingSession.editText(multiText.value);
  renderEditedText();
});
confirmText.addEventListener("click", () => {
  if (readingSession.current) readingSession.current.reviewed = true;
  renderEditedText();
});
cancelRecognition.addEventListener("click", () =>
  cancelCurrentWork("中止しました。前の結果と編集中の文章は保持しています。"),
);
getRequiredElement<HTMLButtonElement>("#accept-result").addEventListener("click", () => {
  readingSession.acceptPending();
  renderCurrentResult();
  updateStoredEvaluation();
});
getRequiredElement<HTMLButtonElement>("#keep-result").addEventListener("click", () => {
  readingSession.pending = null;
  pendingResult.hidden = true;
});
restoreResult.addEventListener("click", () => {
  readingSession.restorePrevious();
  renderCurrentResult();
});
getRequiredElement<HTMLButtonElement>("#use-candidate-text").addEventListener("click", () => {
  readingSession.useCandidateText();
  renderEditedText();
});

saveGroundTruth.addEventListener("click", saveCurrentGroundTruth);
renderKanaComposition();
renderEvaluationSummary();
void initializeGlyphTemplates();
