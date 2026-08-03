export interface LabelEvaluation {
  predicted: string;
  expected: string;
  characterAccuracy: number;
  exactLineRate: number;
  exactMatch: boolean;
  editDistance: number;
  expectedCharacters: number;
}

export function normalizeTranscription(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\s\u3000]+/g, ""))
    .filter((line) => line.length > 0)
    .join("\n");
}

export function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function evaluateTranscription(
  predictedValue: string,
  expectedValue: string,
): LabelEvaluation {
  const predicted = normalizeTranscription(predictedValue);
  const expected = normalizeTranscription(expectedValue);
  const predictedCharacters = predicted.replaceAll("\n", "");
  const expectedCharacters = expected.replaceAll("\n", "");
  const editDistance = levenshteinDistance(predictedCharacters, expectedCharacters);
  const characterAccuracy =
    expectedCharacters.length === 0
      ? predictedCharacters.length === 0
        ? 1
        : 0
      : Math.max(0, 1 - editDistance / expectedCharacters.length);
  const predictedLines = predicted ? predicted.split("\n") : [];
  const expectedLines = expected ? expected.split("\n") : [];
  const totalLines = Math.max(predictedLines.length, expectedLines.length);
  let exactLines = 0;
  for (let index = 0; index < totalLines; index += 1) {
    if (predictedLines[index] !== undefined && predictedLines[index] === expectedLines[index])
      exactLines += 1;
  }

  return {
    predicted,
    expected,
    characterAccuracy,
    exactLineRate: totalLines === 0 ? 1 : exactLines / totalLines,
    exactMatch: predicted === expected,
    editDistance,
    expectedCharacters: expectedCharacters.length,
  };
}
