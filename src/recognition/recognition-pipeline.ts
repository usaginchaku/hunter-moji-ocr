import { DEFAULT_RECOGNITION_REVIEW_THRESHOLDS } from "../domain/recognition-review";
import type { RecognizedGlyphResult, GlyphSize } from "../domain/recognition-result";
import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { BinarizationMode, BinaryGlyphVariant } from "../image/load";
import { extractBasicFeatures, type BinaryGlyph } from "./features";
import { evaluateRecognitionGeometry } from "./geometry-quality";
import { detectHorizontalModifier } from "./modifier-detection";
import { normalizeBinaryGlyph } from "./normalize";
import { assessSmallFormInLine, assessTemplateSmallForms } from "./small-form-detection";
import { rankGlyphCandidates, type GlyphCandidate } from "./similarity";
import { segmentHorizontalText } from "./segment";
import { refineTextSegmentsWithTemplates } from "./template-segmentation";
import { scoreRecognitionVariant, selectBestRecognitionVariant } from "./variant-selection";

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
  backgroundCorrected: boolean;
  surfaceEligible: boolean;
  candidateScores: readonly number[];
  candidateMargins: readonly number[];
  structurePenalty: number;
  dominantCandidateShare: number;
  sourceAspectRatio: number;
}

function hasConfidentCompleteLines(
  attempt: InternalRecognitionAttempt,
  templates: readonly LoadedGlyphTemplate[],
): boolean {
  const lines = new Map<number, RuntimeRecognizedGlyph[]>();
  for (const glyph of attempt.recognized) {
    const line = lines.get(glyph.lineIndex) ?? [];
    line.push(glyph);
    lines.set(glyph.lineIndex, line);
  }
  if (lines.size < 2) return false;
  const thresholds = DEFAULT_RECOGNITION_REVIEW_THRESHOLDS;
  const multiCharacterPeers = [...lines.values()].filter((line) => line.length >= 2).flat();
  const templateById = new Map(templates.map((template) => [template.definition.id, template]));
  const drawingSize = (glyph: RuntimeRecognizedGlyph): number | null => {
    const template = templateById.get(glyph.candidates[0]?.templateId ?? "");
    if (!template?.sourceBounds) return null;
    return (glyph.bbox.height / template.sourceBounds.height) * template.definition.height;
  };
  const referenceSizes = multiCharacterPeers
    .map(drawingSize)
    .filter((size): size is number => size !== null)
    .sort((a, b) => a - b);
  const referenceSize = referenceSizes[Math.floor(referenceSizes.length / 2)];
  return [...lines.values()].every((line) => {
    if (line.length === 1) {
      const glyph = line[0];
      const size = drawingSize(glyph);
      const top = glyph.candidates[0]?.score ?? 0;
      const margin = top - (glyph.candidates[1]?.score ?? 0);
      // A tiny dot or an isolated decoration can match a template very well.
      // Require scale and neighboring text-column evidence for a singleton row.
      if (
        !referenceSize ||
        size === null ||
        size < referenceSize * 0.55 ||
        size > referenceSize * 1.3 ||
        top < 0.85 ||
        margin < 0.12
      )
        return false;
      const centerX = glyph.bbox.x + glyph.bbox.width / 2;
      const centerY = glyph.bbox.y + glyph.bbox.height / 2;
      return multiCharacterPeers.some(
        (peer) =>
          Math.abs(centerX - (peer.bbox.x + peer.bbox.width / 2)) <= referenceSize * 0.65 &&
          Math.abs(centerY - (peer.bbox.y + peer.bbox.height / 2)) <= referenceSize * 2.5,
      );
    }
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
    const clearlySeparatedText =
      variant.preprocessing !== undefined &&
      variant.preprocessing.polarity !== "undetermined" &&
      variant.preprocessing.separation >= 0.9;
    for (const strategy of strategies) {
      const initialSegmentation = segmentHorizontalText(variant.binary, {
        lineStrategy: strategy.lineStrategy,
        // Recovering a framed text surface also exposes thin illustration fragments.
        // The segmenter keeps the original mask if opening removes too much ink.
        applyOpening: variant.backgroundCorrected && !clearlySeparatedText ? true : undefined,
        // Small kana can make normal glyphs look like tall background contamination.
        // Preserve their full outlines when preprocessing already separates the text.
        trimBaselineContamination: !clearlySeparatedText,
        preserveCompactSmallCandidates: clearlySeparatedText,
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
      // Keep variant selection stable while calibrating only the final size decision.
      const smallOutlierCount = recognized.filter((item) => item.automaticSize === "small").length;
      if (clearlySeparatedText) {
        const templateById = new Map(
          templates.map((template) => [template.definition.id, template]),
        );
        const calibratedSizes = assessTemplateSmallForms(
          recognized.map((glyph) => ({
            id: glyph.id,
            lineIndex: glyph.lineIndex,
            ...glyph.bbox,
            template: templateById.get(glyph.candidates[0]?.templateId ?? ""),
            score: glyph.candidates[0]?.score ?? 0,
            margin: (glyph.candidates[0]?.score ?? 0) - (glyph.candidates[1]?.score ?? 0),
            hasModifier: glyph.detectedModifier !== null,
            sizeAlternatives:
              (glyph.candidates[0]?.score ?? 0) - (glyph.candidates.at(-1)?.score ?? 0) >= 0.08
                ? glyph.candidates
                    .slice(1)
                    .filter(
                      (candidate) => (glyph.candidates[0]?.score ?? 0) - candidate.score < 0.08,
                    )
                    .map((candidate) => templateById.get(candidate.templateId))
                : undefined,
          })),
        );
        for (const glyph of recognized) {
          const assessment = calibratedSizes.get(glyph.id);
          const definition = definitions.get(glyph.candidates[0]?.templateId ?? "");
          if (!assessment || !definition?.supportsSmallForm) continue;
          glyph.automaticSize = assessment.isSmall ? "small" : "normal";
          glyph.automaticSizeAmbiguous = assessment.ambiguous;
        }
      }
      const detectedModifierCount = recognized.filter(
        (item) => item.detectedModifier && item.modifierConfidence >= 0.7,
      ).length;
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
        id: `${variant.mode}${variant.backgroundCorrected ? "-surface" : ""}${strategy.idSuffix}`,
        backgroundCorrected: variant.backgroundCorrected === true,
        // A recovered surface may also expose clipped artwork. Do not replace
        // the existing result with low-quality or edge-truncated glyphs.
        surfaceEligible:
          clearlySeparatedText ||
          recognized.every(
            (glyph) =>
              (glyph.candidates[0]?.score ?? 0) >= 0.7 &&
              glyph.bbox.x > 1 &&
              glyph.bbox.y > 1 &&
              glyph.bbox.x + glyph.bbox.width < variant.binary.width - 1 &&
              glyph.bbox.y + glyph.bbox.height < variant.binary.height - 1,
          ),
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
      ? selectBestRecognitionVariant(attempts.filter((attempt) => !attempt.backgroundCorrected))
      : (attempts.find(
          (attempt) =>
            attempt.baseMode === mode &&
            !attempt.backgroundCorrected &&
            !attempt.id.endsWith("-bottom-anchor"),
        ) ?? null);
  if (mode === "auto") {
    const corrected = selectBestRecognitionVariant(
      attempts.filter((attempt) => attempt.backgroundCorrected && attempt.surfaceEligible),
    );
    // Keep the original consensus unchanged. Only an eligible, better-scoring
    // surface candidate may replace its selection.
    if (
      corrected &&
      (!selected || scoreRecognitionVariant(corrected) > scoreRecognitionVariant(selected))
    )
      selected = corrected;
  }
  // A background-noise fallback must not discard confident text lines in a simple image.
  // Keep the original selector for uncertain/colorful scenes and all manual modes.
  if (mode === "auto" && selected?.id.endsWith("-bottom-anchor")) {
    const preprocessing = variants.find(
      (variant) => variant.mode === selected?.baseMode,
    )?.preprocessing;
    const complete = attempts.find(
      (attempt) => attempt.id === selected?.id.replace(/-bottom-anchor$/u, ""),
    );
    if (
      preprocessing &&
      preprocessing.polarity !== "undetermined" &&
      preprocessing.separation >= 0.9 &&
      complete &&
      hasConfidentCompleteLines(complete, templates) &&
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
