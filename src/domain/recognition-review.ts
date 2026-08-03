import type { RecognizedGlyphResult } from "./recognition-result";

export type RecognitionReviewReason =
  | "no-candidate"
  | "low-base-score"
  | "close-base-candidates"
  | "ambiguous-size"
  | "ambiguous-modifier";

export type RecognitionReviewState = "accepted" | "needs-review" | "unrecognized";

export interface RecognitionReviewAssessment {
  state: RecognitionReviewState;
  reasons: readonly RecognitionReviewReason[];
  topScore: number;
  scoreMargin: number;
}

export interface RecognitionReviewThresholds {
  minimumBaseScore: number;
  minimumBaseMargin: number;
  automaticModifierThreshold: number;
  possibleModifierThreshold: number;
}

export const DEFAULT_RECOGNITION_REVIEW_THRESHOLDS: Readonly<RecognitionReviewThresholds> = {
  minimumBaseScore: 0.65,
  minimumBaseMargin: 0.08,
  automaticModifierThreshold: 0.7,
  possibleModifierThreshold: 0.55,
};

export function assessRecognitionReview(
  result: Pick<
    RecognizedGlyphResult,
    | "candidates"
    | "baseSelection"
    | "sizeSelection"
    | "automaticSizeAmbiguous"
    | "detectedModifier"
    | "modifierConfidence"
    | "modifierSelection"
  >,
  thresholds: RecognitionReviewThresholds = DEFAULT_RECOGNITION_REVIEW_THRESHOLDS,
): RecognitionReviewAssessment {
  const topScore = result.candidates[0]?.score ?? 0;
  const scoreMargin = topScore - (result.candidates[1]?.score ?? 0);
  if (result.candidates.length === 0)
    return { state: "unrecognized", reasons: ["no-candidate"], topScore, scoreMargin };

  const reasons: RecognitionReviewReason[] = [];
  if (result.baseSelection === "auto") {
    if (topScore < thresholds.minimumBaseScore) reasons.push("low-base-score");
    if (result.candidates.length > 1 && scoreMargin < thresholds.minimumBaseMargin)
      reasons.push("close-base-candidates");
  }
  if (result.sizeSelection === "auto" && result.automaticSizeAmbiguous)
    reasons.push("ambiguous-size");
  if (
    result.modifierSelection === "auto" &&
    result.detectedModifier &&
    result.modifierConfidence >= thresholds.possibleModifierThreshold &&
    result.modifierConfidence < thresholds.automaticModifierThreshold
  )
    reasons.push("ambiguous-modifier");

  return {
    state: reasons.length > 0 ? "needs-review" : "accepted",
    reasons,
    topScore,
    scoreMargin,
  };
}
