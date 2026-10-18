import assert from "node:assert/strict";
import test from "node:test";
import {
  alignCharacters,
  compareCase,
  compareRuns,
  loadEvaluator,
  traceMetrics,
} from "./compare-generated-regression.mjs";
const { evaluator } = await loadEvaluator();

test("fixed ties and omissions agree with existing scorer", () => {
  for (const [expected, predicted] of [
    ["がか", "かが"],
    ["ぁぃぅぇぉっゃゅょ", ""],
    ["あがぽっ", "がっ"],
    ["いぁっ", "ぃあつ"],
    ["か", "ゃか"],
    ["ぎぎ", "ぎ"],
    ["ぁ\\nぃ", "ぁぃ"],
  ]) {
    const comparison = compareCase(expected, predicted, predicted, evaluator);
    assert.equal(comparison.accepted, true);
  }
  assert.equal(traceMetrics(alignCharacters("がか", "かが")).categories.dakuten.correct, 0);
});

test("equal aggregate count cannot conceal an expected-position regression", () => {
  const report = compareCase("かき", "かあ", "あき", evaluator);
  assert.equal(report.accepted, false);
  assert.deepEqual(
    report.losses.map((p) => p.index),
    [0],
  );
  assert.deepEqual(report.gained, [1]);
});

test("moving false small assignment to another index is rejected", () => {
  const report = compareCase("いあ", "ぃあ", "いぁ", evaluator);
  assert.equal(report.before.smallOnNonSmallCharacters, 1);
  assert.equal(report.after.smallOnNonSmallCharacters, 1);
  assert.deepEqual(
    report.newFalseAssignments.small.map((p) => p.index),
    [1],
  );
  assert.equal(report.accepted, false);
});

test("moving false dakuten assignment is rejected despite stable total", () => {
  const report = compareCase("かき", "がき", "かぎ", evaluator);
  assert.deepEqual(
    report.newFalseAssignments.dakuten.map((p) => p.index),
    [1],
  );
  assert.equal(report.accepted, false);
});

test("insertion increase and lost line breaks are rejected", () => {
  assert.deepEqual(compareCase("か", "か", "ゃか", evaluator).insertedIncreases, ["small"]);
  assert.deepEqual(compareCase("か", "か", "がか", evaluator).insertedIncreases, ["dakuten"]);
  assert.equal(compareCase("か\nき", "か\nき", "かき", evaluator).exactMatchLost, true);
});

test("incomplete runs cannot become accepted by removing denominator", () => {
  const manifest = {
    setId: "test",
    cases: [
      {
        id: "a",
        split: "development",
        expected: "ぁ",
        settings: { inkColor: "#111111", backgroundColor: "#ffffff", transparent: false },
      },
    ],
  };
  const run = {
    setId: "test",
    split: "development",
    completedAt: "now",
    cases: [{ id: "a", state: "success", predicted: "ぁ" }],
  };
  assert.throws(() => compareRuns(manifest, run, { ...run, cases: [] }, evaluator), /Incomplete/u);
  const report = compareRuns(
    manifest,
    run,
    { ...run, cases: [{ id: "a", state: "error", predicted: "ぁ" }] },
    evaluator,
  );
  assert.equal(report.cases[0].after.categories.small.total, 1);
  assert.equal(report.cases[0].after.categories.small.correct, 0);
  assert.equal(report.accepted, false);
});
