import { horizontalGlyphs } from "../../src/glyphs/glyph-map";
import { loadGlyphTemplate } from "../../src/glyphs/load-templates";
import { createGeneratorTextPlan } from "../../src/generator/text-plan";
import {
  computeGeneratorGlyphLayout,
  findOpaqueHorizontalBounds,
} from "../../src/generator/glyph-layout";
import { loadImageAsBinaryGlyphVariants } from "../../src/image/load";
import { runRecognitionPipeline } from "../../src/recognition/recognition-pipeline";
import { resolveGlyphModifier, resolveGlyphOutput } from "../../src/domain/recognition-result";
import { assessRecognitionReview } from "../../src/domain/recognition-review";
import { evaluateTranscription } from "../../src/recognition/label-evaluation";
import { PREPROCESSING_PATTERNS, originalBinarizationVariants } from "./preprocessing-patterns";

const output = document.querySelector<HTMLPreElement>("#result")!;

async function evaluate(): Promise<unknown> {
  const templates = await Promise.all(horizontalGlyphs.map(loadGlyphTemplate));
  const masks = new Map<string, HTMLCanvasElement>();
  for (const glyph of horizontalGlyphs) {
    const image = new Image();
    image.src = glyph.templatePath;
    await image.decode();
    const mask = document.createElement("canvas");
    mask.width = mask.height = 64;
    mask.getContext("2d")!.drawImage(image, 0, 0);
    masks.set(glyph.id, mask);
  }
  // All 47 base glyphs, modifiers, small forms and multiple lines; no third-party images.
  const texts = [
    "あいうえお",
    "かきくけこ",
    "さしすせそ",
    "たちつてと",
    "なにぬねの",
    "はひふへほ",
    "まみむめも",
    "やゆよらり",
    "るれろわをんー",
    "がぎぐげご",
    "ぱぴぷぺぽ",
    "きゃきゅきょ",
    "あっさり",
    "あい\nうえ\nおか",
  ];
  type EvaluationResult = ReturnType<typeof evaluateTranscription> & {
    selectedMode: string | null;
    lineCount: number;
    extracted: number;
    needsReview: number;
    milliseconds: number;
  };
  const recognitionCache = new Map<
    number,
    {
      variants: ReturnType<typeof originalBinarizationVariants>;
      result: EvaluationResult;
    }[]
  >();
  const results: {
    pattern: string;
    caseIndex: number;
    expected: string;
    before: EvaluationResult;
    after: EvaluationResult;
    identicalBinaries: boolean;
  }[] = [];
  for (const pattern of PREPROCESSING_PATTERNS) {
    for (const [caseIndex, expected] of texts.entries()) {
      const plan = createGeneratorTextPlan(expected, 12);
      const canvas = document.createElement("canvas");
      const cell = 64;
      const gap = 16;
      const padding = 16;
      canvas.width =
        padding * 2 + Math.max(...plan.lines.map((line) => line.length)) * (cell + gap) - gap;
      canvas.height = padding * 2 + plan.lines.length * (cell + gap) - gap;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.fillStyle = pattern.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const [row, line] of plan.lines.entries()) {
        for (const [column, token] of line.entries()) {
          if (token.kind !== "glyph") continue;
          const original = masks.get(token.glyph.id)!;
          const mask = document.createElement("canvas");
          mask.width = mask.height = 64;
          const maskContext = mask.getContext("2d")!;
          maskContext.drawImage(original, 0, 0);
          const bounds = findOpaqueHorizontalBounds(
            maskContext.getImageData(0, 0, 64, 64).data,
            64,
            64,
          )!;
          maskContext.globalCompositeOperation = "source-in";
          maskContext.fillStyle = pattern.ink;
          maskContext.fillRect(0, 0, 64, 64);
          const x = padding + column * (cell + gap);
          const y = padding + row * (cell + gap);
          const layout = computeGeneratorGlyphLayout(
            bounds,
            x,
            cell,
            token.small ? 0.7 : 1,
            token.modifier,
          );
          context.drawImage(
            mask,
            layout.drawX,
            y + cell - layout.drawSize,
            layout.drawSize,
            layout.drawSize,
          );
          if (token.modifier && layout.modifierCenterX !== null) {
            context.beginPath();
            context.arc(
              layout.modifierCenterX,
              y + cell * 0.78,
              layout.modifierRadius,
              0,
              Math.PI * 2,
            );
            context.fillStyle = context.strokeStyle = pattern.ink;
            context.lineWidth = Math.max(2, cell * 0.035);
            if (token.modifier === "dakuten") context.fill();
            else context.stroke();
          }
        }
      }
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) =>
          value ? resolve(value) : reject(new Error("PNG encoding failed")),
        ),
      );
      const file = new File([blob], "fixture.png", { type: "image/png" });
      const before = originalBinarizationVariants(rgba, canvas.width, canvas.height);
      const after = await loadImageAsBinaryGlyphVariants(file);
      const recognize = (variants: typeof before) => {
        // Identical bitmaps and fixed templates have identical deterministic OCR results.
        // Compare bytes (not hashes) to reuse those runs across paired color inversions.
        const cached = recognitionCache.get(caseIndex) ?? [];
        const match = cached.find((entry) =>
          variants.every((variant, index) => {
            const previous = entry.variants[index];
            return (
              previous.mode === variant.mode &&
              previous.binary.width === variant.binary.width &&
              previous.binary.height === variant.binary.height &&
              previous.binary.pixels.every((value, pixel) => value === variant.binary.pixels[pixel])
            );
          }),
        );
        if (match) return match.result;
        const start = performance.now();
        const result = runRecognitionPipeline(variants, templates, "auto");
        const selected = result.selected;
        const lines = new Map<number, string[]>();
        for (const glyph of selected?.recognized ?? []) {
          const kana = resolveGlyphOutput(
            glyph.automaticBaseKana,
            "auto",
            glyph.automaticSize,
            resolveGlyphModifier("auto", glyph.detectedModifier, glyph.modifierConfidence),
          ).kana;
          const line = lines.get(glyph.lineIndex) ?? [];
          line.push(kana);
          lines.set(glyph.lineIndex, line);
        }
        const predicted = [...lines.values()].map((line) => line.join("")).join("\n");
        const evaluation = evaluateTranscription(predicted, expected);
        const measured = {
          ...evaluation,
          selectedMode: selected?.id ?? null,
          lineCount: selected?.lineCount ?? 0,
          extracted: selected?.recognized.length ?? 0,
          needsReview:
            selected?.recognized.filter(
              (glyph) => assessRecognitionReview(glyph).state !== "accepted",
            ).length ?? 0,
          milliseconds: performance.now() - start,
          foreground: variants.map((variant) => ({
            mode: variant.mode,
            fraction:
              variant.binary.pixels.reduce((sum, value) => sum + value, 0) /
              variant.binary.pixels.length,
          })),
          attempts: result.attempts.map(({ id, initialCandidateCount, refinedCandidateCount }) => ({
            id,
            initialCandidateCount,
            refinedCandidateCount,
          })),
        };
        cached.push({ variants, result: measured });
        recognitionCache.set(caseIndex, cached);
        return measured;
      };
      results.push({
        pattern: pattern.id,
        caseIndex,
        expected,
        before: recognize(before),
        after: recognize(after),
        identicalBinaries: before.every((variant, index) =>
          variant.binary.pixels.every(
            (value, pixel) => value === after[index].binary.pixels[pixel],
          ),
        ),
      });
      output.textContent = `実行中: ${results.length}/${texts.length * PREPROCESSING_PATTERNS.length}`;
    }
  }
  const summary = PREPROCESSING_PATTERNS.map(({ id }) => {
    const rows = results.filter((row) => row.pattern === id);
    const aggregate = (side: "before" | "after") => ({
      images: rows.length,
      expected: rows.reduce((sum, row) => sum + row[side].expectedCharacters, 0),
      correct: rows.reduce(
        (sum, row) => sum + Math.max(0, row[side].expectedCharacters - row[side].editDistance),
        0,
      ),
      exact: rows.filter((row) => row[side].exactMatch).length,
      extracted: rows.reduce((sum, row) => sum + row[side].extracted, 0),
      needsReview: rows.reduce((sum, row) => sum + row[side].needsReview, 0),
    });
    return {
      pattern: id,
      before: aggregate("before"),
      after: aggregate("after"),
      regressed: rows
        .filter((row) => row.after.characterAccuracy < row.before.characterAccuracy)
        .map((row) => row.caseIndex),
      identicalBinaries: rows.filter((row) => row.identicalBinaries).length,
    };
  });
  return { summary, results };
}

evaluate()
  .then((result) => {
    output.textContent = JSON.stringify(result, null, 2);
    document.body.dataset.complete = "true";
  })
  .catch((error: unknown) => {
    output.textContent = String(error);
    document.body.dataset.complete = "error";
  });
