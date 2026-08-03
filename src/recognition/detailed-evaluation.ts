export type CharacterCategory = "dakuten" | "handakuten" | "small";

export interface CategoryEvaluation {
  total: number;
  top1Correct: number;
  top3Correct: number;
}

export interface DetailedRecognitionEvaluation {
  segmentationExact: boolean;
  alignedCharacters: number;
  top1Correct: number;
  top3Correct: number;
  categories: Readonly<Record<CharacterCategory, CategoryEvaluation>>;
}

export type EvaluationChange = "improved" | "regressed" | "unchanged";

const DAKUTEN_KANA = new Set([
  "が",
  "ぎ",
  "ぐ",
  "げ",
  "ご",
  "ざ",
  "じ",
  "ず",
  "ぜ",
  "ぞ",
  "だ",
  "ぢ",
  "づ",
  "で",
  "ど",
  "ば",
  "び",
  "ぶ",
  "べ",
  "ぼ",
]);
const HANDAKUTEN_KANA = new Set(["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"]);
const SMALL_KANA = new Set(["っ", "ゃ", "ゅ", "ょ"]);

function emptyCategoryEvaluation(): CategoryEvaluation {
  return { total: 0, top1Correct: 0, top3Correct: 0 };
}

function categoryOf(kana: string): CharacterCategory | null {
  if (DAKUTEN_KANA.has(kana)) return "dakuten";
  if (HANDAKUTEN_KANA.has(kana)) return "handakuten";
  if (SMALL_KANA.has(kana)) return "small";
  return null;
}

export function evaluateDetailedRecognition(
  expectedText: string,
  predictedText: string,
  resolvedTopCandidates: readonly (readonly string[])[],
): DetailedRecognitionEvaluation {
  const expected = [...expectedText.replaceAll("\n", "")];
  const predicted = [...predictedText.replaceAll("\n", "")];
  if (resolvedTopCandidates.length !== predicted.length)
    throw new Error("認識文字数と候補一覧の数が一致しません。");

  const categories: Record<CharacterCategory, CategoryEvaluation> = {
    dakuten: emptyCategoryEvaluation(),
    handakuten: emptyCategoryEvaluation(),
    small: emptyCategoryEvaluation(),
  };
  if (expected.length !== predicted.length) {
    return {
      segmentationExact: false,
      alignedCharacters: 0,
      top1Correct: 0,
      top3Correct: 0,
      categories,
    };
  }

  let top1Correct = 0;
  let top3Correct = 0;
  expected.forEach((expectedKana, index) => {
    const candidates = resolvedTopCandidates[index];
    const top1Matches = candidates[0] === expectedKana;
    const top3Matches = candidates.slice(0, 3).includes(expectedKana);
    if (top1Matches) top1Correct += 1;
    if (top3Matches) top3Correct += 1;
    const category = categoryOf(expectedKana);
    if (!category) return;
    categories[category].total += 1;
    if (top1Matches) categories[category].top1Correct += 1;
    if (top3Matches) categories[category].top3Correct += 1;
  });
  return {
    segmentationExact: true,
    alignedCharacters: expected.length,
    top1Correct,
    top3Correct,
    categories,
  };
}

export function compareEvaluationDistance(
  previousEditDistance: number,
  currentEditDistance: number,
): EvaluationChange {
  if (
    !Number.isInteger(previousEditDistance) ||
    previousEditDistance < 0 ||
    !Number.isInteger(currentEditDistance) ||
    currentEditDistance < 0
  )
    throw new Error("比較する編集距離は0以上の整数で指定してください。");
  if (currentEditDistance < previousEditDistance) return "improved";
  if (currentEditDistance > previousEditDistance) return "regressed";
  return "unchanged";
}
