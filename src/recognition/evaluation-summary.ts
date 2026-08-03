export interface StoredEvaluationRecord {
  expectedCharacters: number;
  predictedCharacters: number;
  editDistance: number;
  exactMatch: boolean;
  segmentationExact?: boolean;
  alignedCharacters?: number;
  top1Correct?: number;
  top3Correct?: number;
  categoryCounts?: {
    dakuten: { total: number; top1Correct: number; top3Correct: number };
    handakuten: { total: number; top1Correct: number; top3Correct: number };
    small: { total: number; top1Correct: number; top3Correct: number };
  };
}

export interface EvaluationCategorySummary {
  total: number;
  top1Correct: number;
  top3Correct: number;
  top1Accuracy: number;
  top3Accuracy: number;
}

export interface EvaluationSummary {
  imageCount: number;
  expectedCharacters: number;
  predictedCharacters: number;
  correctCharacters: number;
  characterAccuracy: number;
  exactMatchCount: number;
  exactMatchRate: number;
  segmentationRatio: number;
  detailedImageCount: number;
  segmentationExactCount: number;
  segmentationExactRate: number;
  alignedCharacters: number;
  top1Correct: number;
  top3Correct: number;
  top1Accuracy: number;
  top3Accuracy: number;
  categories: {
    dakuten: EvaluationCategorySummary;
    handakuten: EvaluationCategorySummary;
    small: EvaluationCategorySummary;
  };
}

function summarizeCategory(
  records: readonly StoredEvaluationRecord[],
  category: "dakuten" | "handakuten" | "small",
): EvaluationCategorySummary {
  const total = records.reduce(
    (sum, record) => sum + (record.categoryCounts?.[category].total ?? 0),
    0,
  );
  const top1Correct = records.reduce(
    (sum, record) => sum + (record.categoryCounts?.[category].top1Correct ?? 0),
    0,
  );
  const top3Correct = records.reduce(
    (sum, record) => sum + (record.categoryCounts?.[category].top3Correct ?? 0),
    0,
  );
  return {
    total,
    top1Correct,
    top3Correct,
    top1Accuracy: total === 0 ? 0 : top1Correct / total,
    top3Accuracy: total === 0 ? 0 : top3Correct / total,
  };
}

function hasValidDetailedMetrics(record: StoredEvaluationRecord): boolean {
  if (
    typeof record.segmentationExact !== "boolean" ||
    !Number.isInteger(record.alignedCharacters) ||
    (record.alignedCharacters ?? -1) < 0 ||
    !Number.isInteger(record.top1Correct) ||
    (record.top1Correct ?? -1) < 0 ||
    !Number.isInteger(record.top3Correct) ||
    (record.top3Correct ?? -1) < (record.top1Correct ?? 0) ||
    (record.top3Correct ?? 0) > (record.alignedCharacters ?? 0) ||
    (record.segmentationExact
      ? record.alignedCharacters !== record.expectedCharacters
      : record.alignedCharacters !== 0)
  )
    return false;
  const categories = record.categoryCounts;
  if (!categories) return false;
  return [categories.dakuten, categories.handakuten, categories.small].every(
    (category) =>
      Number.isInteger(category.total) &&
      category.total >= 0 &&
      Number.isInteger(category.top1Correct) &&
      category.top1Correct >= 0 &&
      category.top1Correct <= category.total &&
      Number.isInteger(category.top3Correct) &&
      category.top3Correct >= category.top1Correct &&
      category.top3Correct <= category.total,
  );
}

export function summarizeEvaluationRecords(
  records: readonly StoredEvaluationRecord[],
): EvaluationSummary {
  const expectedCharacters = records.reduce((sum, record) => sum + record.expectedCharacters, 0);
  const predictedCharacters = records.reduce((sum, record) => sum + record.predictedCharacters, 0);
  const correctCharacters = records.reduce(
    (sum, record) => sum + Math.max(0, record.expectedCharacters - record.editDistance),
    0,
  );
  const exactMatchCount = records.filter(({ exactMatch }) => exactMatch).length;
  const detailedRecords = records.filter(hasValidDetailedMetrics);
  const segmentationExactCount = detailedRecords.filter(
    ({ segmentationExact }) => segmentationExact,
  ).length;
  const alignedCharacters = detailedRecords.reduce(
    (sum, record) => sum + (record.alignedCharacters ?? 0),
    0,
  );
  const top1Correct = detailedRecords.reduce((sum, record) => sum + (record.top1Correct ?? 0), 0);
  const top3Correct = detailedRecords.reduce((sum, record) => sum + (record.top3Correct ?? 0), 0);
  return {
    imageCount: records.length,
    expectedCharacters,
    predictedCharacters,
    correctCharacters,
    characterAccuracy: expectedCharacters === 0 ? 0 : correctCharacters / expectedCharacters,
    exactMatchCount,
    exactMatchRate: records.length === 0 ? 0 : exactMatchCount / records.length,
    segmentationRatio: expectedCharacters === 0 ? 0 : predictedCharacters / expectedCharacters,
    detailedImageCount: detailedRecords.length,
    segmentationExactCount,
    segmentationExactRate:
      detailedRecords.length === 0 ? 0 : segmentationExactCount / detailedRecords.length,
    alignedCharacters,
    top1Correct,
    top3Correct,
    top1Accuracy: alignedCharacters === 0 ? 0 : top1Correct / alignedCharacters,
    top3Accuracy: alignedCharacters === 0 ? 0 : top3Correct / alignedCharacters,
    categories: {
      dakuten: summarizeCategory(detailedRecords, "dakuten"),
      handakuten: summarizeCategory(detailedRecords, "handakuten"),
      small: summarizeCategory(detailedRecords, "small"),
    },
  };
}
