/* global process, console */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalize = (text) =>
  text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\s\u3000]+/gu, ""))
    .filter(Boolean)
    .join("\n");
const category = (kana) =>
  /^[ぁぃぅぇぉっゃゅょ]$/u.test(kana)
    ? "small"
    : /^[がぎぐげござじずぜぞだぢづでどばびぶべぼゔ]$/u.test(kana)
      ? "dakuten"
      : /^[ぱぴぷぺぽ]$/u.test(kana)
        ? "handakuten"
        : "ordinary";

export function alignCharacters(expectedText, predictedText) {
  const expected = [...normalize(expectedText).replaceAll("\n", "")];
  const predicted = [...normalize(predictedText).replaceAll("\n", "")];
  const columns = predicted.length + 1;
  if ((expected.length + 1) * columns > 1_000_000) throw new Error("Alignment too large");
  const distance = new Uint32Array((expected.length + 1) * columns);
  for (let x = 0; x < columns; x++) distance[x] = x;
  for (let y = 1; y <= expected.length; y++) {
    distance[y * columns] = y;
    for (let x = 1; x < columns; x++)
      distance[y * columns + x] = Math.min(
        distance[(y - 1) * columns + x - 1] + (expected[y - 1] === predicted[x - 1] ? 0 : 1),
        distance[(y - 1) * columns + x] + 1,
        distance[y * columns + x - 1] + 1,
      );
  }
  const positions = expected.map((kana, index) => ({
    index,
    expected: kana,
    category: category(kana),
    predicted: null,
    predictedIndex: null,
    correct: false,
  }));
  const insertions = [];
  let y = expected.length;
  let x = predicted.length;
  while (y > 0 || x > 0) {
    const same = y > 0 && x > 0 && expected[y - 1] === predicted[x - 1];
    // Match the frozen production scorer: diagonal, deletion, insertion.
    if (
      y > 0 &&
      x > 0 &&
      distance[y * columns + x] === distance[(y - 1) * columns + x - 1] + (same ? 0 : 1)
    ) {
      Object.assign(positions[y - 1], {
        predicted: predicted[x - 1],
        predictedIndex: x - 1,
        correct: same,
      });
      y--;
      x--;
    } else if (y > 0 && distance[y * columns + x] === distance[(y - 1) * columns + x] + 1) y--;
    else {
      insertions.push({
        beforeExpectedIndex: y,
        predictedIndex: x - 1,
        predicted: predicted[x - 1],
        category: category(predicted[x - 1]),
      });
      x--;
    }
  }
  return {
    positions,
    insertions: insertions.reverse(),
    editDistance: distance[expected.length * columns + predicted.length],
    exactMatch: normalize(expectedText) === normalize(predictedText),
  };
}

export function traceMetrics(trace) {
  const categories = Object.fromEntries(
    ["ordinary", "small", "dakuten", "handakuten"].map((kind) => [kind, { total: 0, correct: 0 }]),
  );
  const byKana = {};
  for (const item of trace.positions) {
    categories[item.category].total++;
    categories[item.category].correct += Number(item.correct);
    byKana[item.expected] ??= { total: 0, correct: 0 };
    byKana[item.expected].total++;
    byKana[item.expected].correct += Number(item.correct);
  }
  const falseAssignments = (kind) =>
    trace.positions.filter(
      (p) => p.predicted !== null && category(p.predicted) === kind && p.category !== kind,
    );
  const inserted = (kind) => trace.insertions.filter((i) => i.category === kind).length;
  return {
    categories,
    byKana,
    smallOnNonSmallCharacters: falseAssignments("small").length,
    dakutenOnNonDakutenCharacters: falseAssignments("dakuten").length,
    insertedSmallOutputs: inserted("small"),
    insertedDakutenOutputs: inserted("dakuten"),
  };
}

function assertScorerAgreement(trace, score) {
  const metrics = traceMetrics(trace);
  for (const kind of ["small", "dakuten", "handakuten"])
    for (const key of ["total", "correct"])
      if (metrics.categories[kind][key] !== score.categories[kind][key])
        throw new Error("Scorer category mismatch");
  for (const [kana, counts] of Object.entries(metrics.byKana))
    if (
      counts.total !== score.byKana[kana]?.total ||
      counts.correct !== score.byKana[kana]?.correct
    )
      throw new Error("Scorer kana mismatch");
  for (const key of [
    "smallOnNonSmallCharacters",
    "dakutenOnNonDakutenCharacters",
    "insertedSmallOutputs",
    "insertedDakutenOutputs",
  ])
    if (metrics[key] !== score[key]) throw new Error("Scorer false-assignment mismatch");
  if (trace.editDistance !== score.editDistance || trace.exactMatch !== score.exactMatch)
    throw new Error("Scorer alignment mismatch");
}

export function compareCase(expected, beforeText, afterText, evaluator) {
  const before = alignCharacters(expected, beforeText);
  const after = alignCharacters(expected, afterText);
  if (evaluator) {
    assertScorerAgreement(before, evaluator(expected, beforeText));
    assertScorerAgreement(after, evaluator(expected, afterText));
  }
  const losses = before.positions
    .filter((p) => p.correct && !after.positions[p.index].correct)
    .map((p) => ({ ...p, before: p.predicted, after: after.positions[p.index].predicted }));
  const gained = after.positions
    .filter((p) => p.correct && !before.positions[p.index].correct)
    .map((p) => p.index);
  const newFalseAssignments = {};
  for (const kind of ["small", "dakuten"]) {
    const falseAt = (p) =>
      p.predicted !== null && category(p.predicted) === kind && p.category !== kind;
    newFalseAssignments[kind] = after.positions.filter(
      (p) => falseAt(p) && !falseAt(before.positions[p.index]),
    );
  }
  const beforeMetrics = traceMetrics(before);
  const afterMetrics = traceMetrics(after);
  const insertedIncreases = ["small", "dakuten"].filter((kind) => {
    const key = kind === "small" ? "insertedSmallOutputs" : "insertedDakutenOutputs";
    return afterMetrics[key] > beforeMetrics[key];
  });
  return {
    before: beforeMetrics,
    after: afterMetrics,
    losses,
    gained,
    exactMatchLost: before.exactMatch && !after.exactMatch,
    newFalseAssignments,
    insertedIncreases,
    accepted:
      losses.length === 0 &&
      !(before.exactMatch && !after.exactMatch) &&
      Object.values(newFalseAssignments).every((items) => items.length === 0) &&
      insertedIncreases.length === 0,
    beforeTrace: before,
    afterTrace: after,
  };
}

function polarity(settings) {
  if (settings.transparent) return "transparent";
  const luminance = (hex) => {
    const rgb = hex
      .slice(1)
      .match(/../gu)
      .map((v) => Number.parseInt(v, 16));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const difference = luminance(settings.backgroundColor) - luminance(settings.inkColor);
  return difference > 0 ? "dark-text" : difference < 0 ? "light-text" : "equal-luminance";
}

export function compareRuns(manifest, baseline, candidate, evaluator) {
  if (
    baseline.split !== candidate.split ||
    baseline.setId !== candidate.setId ||
    baseline.setId !== manifest.setId
  )
    throw new Error("Different evaluation identities");
  const items = manifest.cases.filter((c) => c.split === baseline.split);
  if (!items.length) throw new Error("Empty evaluation split");
  const ids = new Set(items.map((c) => c.id));
  if (ids.size !== items.length) throw new Error("Duplicate manifest IDs");
  for (const run of [baseline, candidate]) {
    if (
      !run.completedAt ||
      run.cases.length !== items.length ||
      new Set(run.cases.map((c) => c.id)).size !== items.length ||
      run.cases.some((c) => !ids.has(c.id))
    )
      throw new Error("Incomplete or mismatched run");
  }
  const cases = items.map((item) => {
    const before = baseline.cases.find((c) => c.id === item.id);
    const after = candidate.cases.find((c) => c.id === item.id);
    return {
      id: item.id,
      image: item.image,
      polarity: polarity(item.settings),
      beforeState: before.state,
      afterState: after.state,
      ...compareCase(
        item.expected,
        before.state === "success" ? before.predicted : "",
        after.state === "success" ? after.predicted : "",
        evaluator,
      ),
    };
  });
  const grouped = {};
  for (const item of cases)
    for (const group of ["all", item.polarity]) {
      const summary = (grouped[group] ??= {
        images: 0,
        before: {},
        after: {},
        losses: 0,
        newFalseSmall: 0,
        newFalseDakuten: 0,
      });
      summary.images++;
      summary.losses += item.losses.length;
      summary.newFalseSmall += item.newFalseAssignments.small.length;
      summary.newFalseDakuten += item.newFalseAssignments.dakuten.length;
      for (const side of ["before", "after"])
        for (const [kana, counts] of Object.entries(item[side].byKana)) {
          const total = (summary[side][kana] ??= { total: 0, correct: 0 });
          total.total += counts.total;
          total.correct += counts.correct;
        }
    }
  return {
    accepted: cases.every(
      (c) => c.accepted && !(c.beforeState === "success" && c.afterState !== "success"),
    ),
    setId: manifest.setId,
    split: baseline.split,
    policy:
      "No expected-position correct-to-incorrect loss, no exact-image loss, no new false-small/dakuten expected position, no per-image small/dakuten insertion increase. Gains never cancel losses.",
    baselineCommit: baseline.sourceCommit,
    candidateCommit: candidate.sourceCommit,
    grouped,
    cases,
  };
}

export async function loadEvaluator() {
  const moduleUrl = (source) =>
    "data:text/javascript;base64," + globalThis.Buffer.from(source).toString("base64");
  const labels = moduleUrl(
    stripTypeScriptTypes(await readFile(join(root, "src/recognition/label-evaluation.ts"), "utf8")),
  );
  const source = await readFile(
    join(root, "src/recognition/final-transcription-evaluation.ts"),
    "utf8",
  );
  return {
    evaluator: (
      await import(
        moduleUrl(
          stripTypeScriptTypes(source).replace('"./label-evaluation"', JSON.stringify(labels)),
        )
      )
    ).evaluateFinalTranscription,
    evaluatorSha256: sha(source),
  };
}

async function main() {
  const [manifestPath, baselinePath, candidatePath, outputPath] = process.argv.slice(2);
  if (!manifestPath || !baselinePath || !candidatePath || !outputPath)
    throw new Error(
      "Usage: node tests/audit/compare-generated-regression.mjs manifest.json baseline.json candidate.json new-report.json",
    );
  const paths = [manifestPath, baselinePath, candidatePath].map((p) => resolve(p));
  const bytes = await Promise.all(paths.map((p) => readFile(p)));
  const [manifest, baseline, candidate] = bytes.map((b) => JSON.parse(b.toString()));
  for (const run of [baseline, candidate])
    if (run.manifestSha256 !== sha(bytes[0])) throw new Error("Raw run manifest hash mismatch");
  const generationBytes = await readFile(join(dirname(paths[0]), "generation.json"));
  const generation = JSON.parse(generationBytes.toString());
  if (generation.manifestSha256 !== sha(bytes[0]))
    throw new Error("Generation manifest hash mismatch");
  const hashes = [];
  for (const item of manifest.cases.filter((c) => c.split === baseline.split)) {
    const hash = sha(await readFile(join(dirname(paths[0]), item.image)));
    if (hash !== generation.images.find((g) => g.id === item.id)?.sha256)
      throw new Error("PNG hash mismatch: " + item.id);
    hashes.push({ id: item.id, sha256: hash });
  }
  const { evaluator, evaluatorSha256 } = await loadEvaluator();
  const report = {
    recordedAt: new Date().toISOString(),
    inputs: Object.fromEntries(paths.map((p, i) => [p, sha(bytes[i])])),
    generationSha256: sha(generationBytes),
    evaluatorSha256,
    verifiedImages: hashes,
    uniqueImageCount: new Set(hashes.map((h) => h.sha256)).size,
    ...compareRuns(manifest, baseline, candidate, evaluator),
  };
  await writeFile(resolve(outputPath), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      accepted: report.accepted,
      images: report.cases.length,
      losses: report.grouped.all.losses,
      report: resolve(outputPath),
    }),
  );
  if (!report.accepted) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
