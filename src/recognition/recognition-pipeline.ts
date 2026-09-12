import { DEFAULT_RECOGNITION_REVIEW_THRESHOLDS } from "../domain/recognition-review";
import type { RecognizedGlyphResult, GlyphSize } from "../domain/recognition-result";
import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { BinarizationMode, BinaryGlyphVariant } from "../image/load";
import { extractBasicFeatures, type BinaryGlyph } from "./features";
import { evaluateRecognitionGeometry } from "./geometry-quality";
import { detectHorizontalModifier } from "./modifier-detection";
import { normalizeBinaryGlyph } from "./normalize";
import { assessSmallFormInLine } from "./small-form-detection";
import { rankGlyphCandidates, type GlyphCandidate } from "./similarity";
import { segmentHorizontalText } from "./segment";
import { refineTextSegmentsWithTemplates } from "./template-segmentation";
import { selectBestRecognitionVariant } from "./variant-selection";

export type RuntimeRecognizedGlyph = Omit<RecognizedGlyphResult, "candidates"> & {
  relativeHeight: number;
  binary: BinaryGlyph;
  candidates: GlyphCandidate[];
};

export type RecognitionPipelineMode = "auto" | BinarizationMode;

export interface RecognitionAttemptSummary {
  id: string;
  baseMode: BinarizationMode;
  label: string;
  initialCandidateCount: number;
  refinedCandidateCount: number;
}

export interface SelectedRecognitionAttempt extends RecognitionAttemptSummary {
  lineCount: number;
  recognized: RuntimeRecognizedGlyph[];
}

export interface RecognitionPipelineResult {
  attempts: RecognitionAttemptSummary[];
  selected: SelectedRecognitionAttempt | null;
}

interface InternalRecognitionAttempt extends SelectedRecognitionAttempt {
  candidateScores: readonly number[];
  candidateMargins: readonly number[];
  structurePenalty: number;
  dominantCandidateShare: number;
  sourceAspectRatio: number;
}

function hasConfidentCompleteLines(attempt: InternalRecognitionAttempt): boolean {
  const lines = new Map<number, RuntimeRecognizedGlyph[]>();
  for (const glyph of attempt.recognized) {
    const line = lines.get(glyph.lineIndex) ?? [];
    line.push(glyph);
    lines.set(glyph.lineIndex, line);
  }
  if (lines.size < 2) return false;
  const thresholds = DEFAULT_RECOGNITION_REVIEW_THRESHOLDS;
  return [...lines.values()].every((line) => {
    if (line.length < 2) return false;
    const meanScore =
      line.reduce((sum, glyph) => sum + (glyph.candidates[0]?.score ?? 0), 0) / line.length;
    const accepted = line.filter((glyph) => {
      const top = glyph.candidates[0]?.score ?? 0;
      const margin = top - (glyph.candidates[1]?.score ?? 0);
      return top >= thresholds.minimumBaseScore && margin >= thresholds.minimumBaseMargin;
    }).length;
    return meanScore >= 0.8 && accepted / line.length >= 0.75;
  });
}

export function runRecognitionPipeline(
  variants: readonly BinaryGlyphVariant[],
  templates: readonly LoadedGlyphTemplate[],
  mode: RecognitionPipelineMode,
): RecognitionPipelineResult {
  const attempts: InternalRecognitionAttempt[] = [];
  const definitions = new Map(
    templates.map((template) => [template.definition.id, template.definition]),
  );

  for (const variant of variants) {
    const strategies = [
      { idSuffix: "", labelSuffix: "", lineStrategy: "all" as const },
      {
        idSuffix: "-bottom-anchor",
        labelSuffix: "（下線上端基準）",
        lineStrategy: "bottom-anchor" as const,
      },
    ];
    for (const strategy of strategies) {
      const initialSegmentation = segmentHorizontalText(variant.binary, {
        lineStrategy: strategy.lineStrategy,
      });
      const segments = refineTextSegmentsWithTemplates(initialSegmentation.segments, templates);
      if (segments.length === 0 || segments.length > 160) continue;

      const recognized = segments.map<RuntimeRecognizedGlyph>((segment) => {
        const modifierDetection = segment.modifierAttachment
          ? {
              base: segment.modifierAttachment.baseBinary,
              modifier: segment.modifierAttachment.modifier,
              confidence: segment.modifierAttachment.confidence,
            }
          : detectHorizontalModifier(segment.binary);
        const originalBinary = normalizeBinaryGlyph(segment.binary);
        const originalCandidates = rankGlyphCandidates(
          { binary: originalBinary, features: extractBasicFeatures(originalBinary) },
          templates,
        );
        const strippedBinary = normalizeBinaryGlyph(modifierDetection.base);
        const strippedCandidates = rankGlyphCandidates(
          { binary: strippedBinary, features: extractBasicFeatures(strippedBinary) },
          templates,
        );
        const strippedTopDefinition = definitions.get(strippedCandidates[0]?.templateId ?? "");
        const supportedDetectedModifier =
          modifierDetection.modifier === "dakuten"
            ? strippedTopDefinition?.supportsDakuten === true
            : modifierDetection.modifier === "handakuten"
              ? strippedTopDefinition?.supportsHandakuten === true
              : false;
        const binary = supportedDetectedModifier ? strippedBinary : originalBinary;
        const candidates = supportedDetectedModifier ? strippedCandidates : originalCandidates;
        const topDefinition = definitions.get(candidates[0]?.templateId ?? "");
        const sizeAssessment = assessSmallFormInLine(segment, segments);
        const automaticSize: GlyphSize =
          topDefinition?.supportsSmallForm === true && sizeAssessment.isSmall ? "small" : "normal";
        return {
          id: segment.id,
          lineIndex: segment.lineIndex,
          bbox: {
            x: segment.x,
            y: segment.y,
            width: segment.width,
            height: segment.height,
          },
          relativeHeight: segment.relativeHeight,
          automaticBaseKana: candidates[0]?.kana ?? "",
          selectedBaseKana: candidates[0]?.kana ?? "",
          baseSelection: "auto",
          automaticSize,
          automaticSizeAmbiguous:
            topDefinition?.supportsSmallForm === true && sizeAssessment.ambiguous,
          sizeSelection: "auto",
          detectedModifier: supportedDetectedModifier ? modifierDetection.modifier : null,
          modifierConfidence: supportedDetectedModifier ? modifierDetection.confidence : 0,
          modifierSelection: "auto",
          modifierAssociation: segment.modifierAttachment
            ? {
                baseSourceId: segment.modifierAttachment.baseSourceId,
                markSourceId: segment.modifierAttachment.markSourceId,
              }
            : null,
          binary,
          candidates,
        };
      });
      const detectedModifierCount = recognized.filter(
        (item) => item.detectedModifier && item.modifierConfidence >= 0.7,
      ).length;
      const smallOutlierCount = recognized.filter((item) => item.automaticSize === "small").length;
      const kanaFrequency = new Map<string, number>();
      recognized.forEach((item) => {
        const kana = item.candidates[0]?.kana ?? "";
        if (kana) kanaFrequency.set(kana, (kanaFrequency.get(kana) ?? 0) + 1);
      });
      const dominantKanaShare = recognized.length
        ? Math.max(0, ...kanaFrequency.values()) / recognized.length
        : 0;
      const geometryQuality = evaluateRecognitionGeometry(recognized.map(({ bbox }) => bbox));
      const modePriorPenalty =
        variant.mode === "background" ? 0 : variant.mode === "neutral-ink" ? 0.08 : 0.05;
      attempts.push({
        id: `${variant.mode}${strategy.idSuffix}`,
        baseMode: variant.mode,
        label: `${variant.label}${strategy.labelSuffix}`,
        initialCandidateCount: initialSegmentation.segments.length,
        refinedCandidateCount: segments.length,
        lineCount: initialSegmentation.lineCount,
        recognized,
        candidateScores: recognized.map((item) => item.candidates[0]?.score ?? 0),
        candidateMargins: recognized.map(
          (item) => (item.candidates[0]?.score ?? 0) - (item.candidates[1]?.score ?? 0),
        ),
        dominantCandidateShare: dominantKanaShare,
        sourceAspectRatio: variant.binary.width / variant.binary.height,
        structurePenalty:
          detectedModifierCount * 0.018 +
          Math.max(0, smallOutlierCount - 1) * 0.025 +
          geometryQuality.penalty +
          modePriorPenalty,
      });
    }
  }

  let selected =
    mode === "auto"
      ? selectBestRecognitionVariant(attempts)
      : (attempts.find(
          (attempt) => attempt.baseMode === mode && !attempt.id.endsWith("-bottom-anchor"),
        ) ?? null);
  // A background-noise fallback must not discard confident text lines in a simple image.
  // Keep the original selector for uncertain/colorful scenes and all manual modes.
  if (mode === "auto" && selected?.id.endsWith("-bottom-anchor")) {
    const preprocessing = variants.find(
      (variant) => variant.mode === selected?.baseMode,
    )?.preprocessing;
    const complete = attempts.find((attempt) => attempt.id === selected?.baseMode);
    if (
      preprocessing &&
      preprocessing.polarity !== "undetermined" &&
      preprocessing.separation >= 0.9 &&
      complete &&
      hasConfidentCompleteLines(complete) &&
      selected.recognized.every((partial) =>
        complete.recognized.some(
          (full) =>
            full.automaticBaseKana === partial.automaticBaseKana &&
            full.bbox.x === partial.bbox.x &&
            full.bbox.y === partial.bbox.y &&
            full.bbox.width === partial.bbox.width &&
            full.bbox.height === partial.bbox.height,
        ),
      )
    )
      selected = complete;
  }
  return {
    attempts: attempts.map(
      ({ id, baseMode, label, initialCandidateCount, refinedCandidateCount }) => ({
        id,
        baseMode,
        label,
        initialCandidateCount,
        refinedCandidateCount,
      }),
    ),
    selected,
  };
}
