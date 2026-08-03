export interface RecognitionVariantQuality {
  id: string;
  candidateScores: readonly number[];
  candidateMargins: readonly number[];
  structurePenalty?: number;
  dominantCandidateShare?: number;
  lineCount?: number;
  sourceAspectRatio?: number;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreRecognitionVariant(variant: RecognitionVariantQuality): number {
  if (variant.candidateScores.length === 0) return Number.NEGATIVE_INFINITY;
  if (
    variant.candidateScores.some((value) => !Number.isFinite(value)) ||
    variant.candidateMargins.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("認識方式の評価値が不正です。");
  }
  if (
    variant.structurePenalty !== undefined &&
    (!Number.isFinite(variant.structurePenalty) || variant.structurePenalty < 0)
  )
    throw new Error("認識方式の構造ペナルティが不正です。");
  if (
    variant.dominantCandidateShare !== undefined &&
    (!Number.isFinite(variant.dominantCandidateShare) ||
      variant.dominantCandidateShare < 0 ||
      variant.dominantCandidateShare > 1)
  )
    throw new Error("認識方式の候補偏重率が不正です。");

  if (
    variant.lineCount !== undefined &&
    (!Number.isInteger(variant.lineCount) || variant.lineCount <= 0)
  )
    throw new Error("認識方式の行数は1以上の整数で指定してください。");
  if (
    variant.sourceAspectRatio !== undefined &&
    (!Number.isFinite(variant.sourceAspectRatio) || variant.sourceAspectRatio <= 0)
  )
    throw new Error("認識方式の画像縦横比は0より大きい値で指定してください。");

  const meanScore = average(variant.candidateScores);
  const meanMargin = variant.candidateMargins.length ? average(variant.candidateMargins) : 0;
  const usefulCandidateBonus = Math.min(12, variant.candidateScores.length) * 0.003;
  const dominantShare = variant.dominantCandidateShare ?? 0;
  const repetitionPenalty = dominantShare > 0.75 ? 0.4 : Math.max(0, dominantShare - 0.45) * 0.25;
  const linePenalty = Math.max(0, (variant.lineCount ?? 1) - 1) * 0.16;
  const candidateCountPenalty = (() => {
    if (variant.sourceAspectRatio === undefined) return 0;
    const plausibleCandidateCount = Math.max(3, Math.ceil(variant.sourceAspectRatio * 4.25));
    const excessCandidateRatio = Math.max(
      0,
      (variant.candidateScores.length - plausibleCandidateCount) / plausibleCandidateCount,
    );
    return Math.min(1, excessCandidateRatio * 0.38);
  })();
  const candidateDeficitPenalty = (() => {
    if (variant.sourceAspectRatio === undefined || variant.sourceAspectRatio < 2.5) return 0;
    const conservativeMinimum = Math.max(2, Math.floor(variant.sourceAspectRatio * 1.75));
    const deficit = Math.max(0, conservativeMinimum - variant.candidateScores.length);
    return Math.min(0.24, deficit * 0.12);
  })();
  return (
    meanScore +
    meanMargin * 0.3 +
    usefulCandidateBonus -
    (variant.structurePenalty ?? 0) -
    repetitionPenalty -
    linePenalty -
    candidateCountPenalty -
    candidateDeficitPenalty
  );
}

export function selectBestRecognitionVariant<T extends RecognitionVariantQuality>(
  variants: readonly T[],
): T | null {
  const candidateCounts = variants
    .map((variant) => variant.candidateScores.length)
    .filter((count) => count > 0)
    .sort((left, right) => left - right);
  const consensusCount = candidateCounts.length
    ? candidateCounts[Math.floor(candidateCounts.length / 2)]
    : 0;
  const consensusDeficitPenalty = (variant: T): number => {
    if (consensusCount < 3 || variant.candidateScores.length < 2) return 0;
    return Math.min(0.24, Math.max(0, consensusCount - variant.candidateScores.length) * 0.12);
  };
  return (
    [...variants].sort(
      (left, right) =>
        scoreRecognitionVariant(right) -
          consensusDeficitPenalty(right) -
          (scoreRecognitionVariant(left) - consensusDeficitPenalty(left)) ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}
