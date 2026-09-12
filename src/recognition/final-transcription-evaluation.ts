import { normalizeTranscription } from "./label-evaluation";

export interface FinalCharacterEvaluation {
  total: number;
  correct: number;
}

export interface FinalTranscriptionEvaluation {
  editDistance: number;
  expectedCharacters: number;
  predictedCharacters: number;
  exactMatch: boolean;
  categories: Record<"dakuten" | "handakuten" | "small", FinalCharacterEvaluation>;
  incorrectDakutenOutputs: number;
  spuriousDakutenOutputs: number;
}

function categoryOf(kana: string): "dakuten" | "handakuten" | "small" | null {
  if (/[がぎぐげござじずぜぞだぢづでどばびぶべぼゔ]/u.test(kana)) return "dakuten";
  if (/[ぱぴぷぺぽ]/u.test(kana)) return "handakuten";
  if (/[ぁぃぅぇぉっゃゅょ]/u.test(kana)) return "small";
  return null;
}

/** Evaluate final output, retaining every expected character, including unextracted ones. */
export function evaluateFinalTranscription(
  expectedText: string,
  predictedText: string,
): FinalTranscriptionEvaluation {
  const expectedNormalized = normalizeTranscription(expectedText);
  const predictedNormalized = normalizeTranscription(predictedText);
  const expected = [...expectedNormalized.replaceAll("\n", "")];
  const predicted = [...predictedNormalized.replaceAll("\n", "")];
  const columns = predicted.length + 1;
  // This evaluator is for short OCR labels; bound the quadratic trace allocation explicitly.
  if ((expected.length + 1) * columns > 1_000_000)
    throw new Error("文字対応の評価対象が大きすぎます。短い画像ラベルごとに評価してください。");
  const distances = new Uint32Array((expected.length + 1) * columns);
  for (let x = 0; x <= predicted.length; x += 1) distances[x] = x;
  for (let y = 1; y <= expected.length; y += 1) {
    distances[y * columns] = y;
    for (let x = 1; x <= predicted.length; x += 1) {
      distances[y * columns + x] = Math.min(
        distances[(y - 1) * columns + x - 1] + (expected[y - 1] === predicted[x - 1] ? 0 : 1),
        distances[(y - 1) * columns + x] + 1,
        distances[y * columns + x - 1] + 1,
      );
    }
  }
  const categories: FinalTranscriptionEvaluation["categories"] = {
    dakuten: { total: 0, correct: 0 },
    handakuten: { total: 0, correct: 0 },
    small: { total: 0, correct: 0 },
  };
  for (const kana of expected) {
    const category = categoryOf(kana);
    if (category) categories[category].total += 1;
  }
  let correctDakutenOutputs = 0;
  let spuriousDakutenOutputs = 0;
  let y = expected.length;
  let x = predicted.length;
  while (y > 0 || x > 0) {
    const same = y > 0 && x > 0 && expected[y - 1] === predicted[x - 1];
    // Fixed tie order: diagonal, deletion, insertion. Never optimize ties for a category score.
    if (
      y > 0 &&
      x > 0 &&
      distances[y * columns + x] === distances[(y - 1) * columns + x - 1] + (same ? 0 : 1)
    ) {
      if (same) {
        const category = categoryOf(expected[y - 1]);
        if (category) categories[category].correct += 1;
        if (category === "dakuten") correctDakutenOutputs += 1;
      }
      if (categoryOf(predicted[x - 1]) === "dakuten" && categoryOf(expected[y - 1]) !== "dakuten")
        spuriousDakutenOutputs += 1;
      y -= 1;
      x -= 1;
    } else if (y > 0 && distances[y * columns + x] === distances[(y - 1) * columns + x] + 1) {
      y -= 1;
    } else {
      if (categoryOf(predicted[x - 1]) === "dakuten") spuriousDakutenOutputs += 1;
      x -= 1;
    }
  }
  return {
    editDistance: distances[expected.length * columns + predicted.length],
    expectedCharacters: expected.length,
    predictedCharacters: predicted.length,
    exactMatch: expectedNormalized === predictedNormalized,
    categories,
    spuriousDakutenOutputs,
    incorrectDakutenOutputs:
      predicted.filter((kana) => categoryOf(kana) === "dakuten").length - correctDakutenOutputs,
  };
}
