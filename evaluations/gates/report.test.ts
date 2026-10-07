import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { createGateSuiteRecord } from "./contracts.ts";
import type { GateSuiteCase, PublicGateRubric } from "./contracts.ts";
import { runGateCalibration, replayGateCalibration } from "./calibration.ts";
import type {
  CalibrationAdapterInput,
  CalibrationAttempt,
  CalibrationEvaluator,
  GateCalibrationReplay,
} from "./calibration.ts";
import {
  compareGateCalibrationReports,
  projectGateCalibration,
} from "./report.ts";

// Inventory: arithmetic/all-fail/abstention; missing/identity/refusal; reserved/unreviewed;
// repeats/configuration/unknowns; exact bindings/coverage. All use real archive/run/replay.
// Scripted callback responses are software controls, never evidence of model accuracy.
const criteria: PublicGateRubric["criteria"] = ["action", "verification"].map(
  (id) => ({
    type: "semantic_evaluation",
    id,
    question: "Synthetic software question",
    target: { kind: "step_output" },
    evidence_requirements: { min_items: 1 },
    result: { kind: "boolean" },
    acceptance: { kind: "equals", value: true },
    allow_not_applicable: true,
  }),
);
async function fixture(reviewed = true) {
  const root = await mkdtemp(join(tmpdir(), "gate-report-control-"));
  const archive = await EvaluationArchive.open(root);
  const receipt = await archive.putBlob(
    Buffer.from("software label receipt"),
    "text/plain",
  );
  const definition = {
    id: "software-gate",
    name: "Software",
    type: "validation",
    description: "Software",
    guidance: "Software",
    pass_criteria: criteria,
    evaluation: { mode: "self", strict: true },
  };
  const gate_snapshot = await archive.putBlob(
    Buffer.from(canonicalJson(definition)),
    "application/json",
  );
  const public_rubric: PublicGateRubric = {
    gate_id: definition.id,
    definition_digest: gate_snapshot.digest,
    criteria,
  };
  const cases: GateSuiteCase[] = [];
  for (const family of [
    "positive",
    "negative",
    "valid_alternative",
    "boundary",
    "insufficient_evidence",
  ] as const) {
    const state =
      family === "negative"
        ? "unmet"
        : family === "insufficient_evidence"
          ? "insufficient_evidence"
          : "met";
    cases.push({
      case_id: family,
      family,
      exposure: "development",
      target_ref: await archive.putBlob(
        Buffer.from(`software target ${family}`),
        "text/plain;charset=utf-8",
      ),
      expected_criterion_states: { action: state, verification: "met" },
      expected_acceptance: state === "met",
      label_review: reviewed
        ? {
            state: "reviewed",
            authority: "agent",
            reviewer_id: "supplied-software-author",
            evidence_refs: [receipt],
          }
        : { state: "unreviewed", reason: "control" },
    });
  }
  cases.push({ ...cases[0]!, case_id: "reserved", exposure: "reserved" });
  const suite = createGateSuiteRecord(
    {
      suite_id: "software-suite",
      revision: "1",
      gate_id: definition.id,
      definition_digest: gate_snapshot.digest,
      criterion_ids: criteria.map((item) => item.id),
      cases,
      human_calibration: { state: "unknown", reason: "software only" },
    },
    {
      adapter: { id: "software", version: "1" },
      source: { id: "software", version: "1" },
      refs: [receipt],
    },
    public_rubric,
  );
  return {
    root,
    archive,
    suite,
    public_rubric,
    gate_snapshot,
    evaluator: {
      id: "software-callback",
      revision: "1",
      configuration: { requested_model: "must-not-be-observed" },
    } satisfies CalibrationEvaluator,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(
  body: (f: Fixture) => Promise<void>,
  reviewed = true,
) {
  const f = await fixture(reviewed);
  try {
    await body(f);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}
function attempt(case_id: string, index: number): CalibrationAttempt {
  return {
    case_id,
    identity: {
      experiment_id: "software-experiment",
      task_id: `task-${index}`,
      variant_id: "software-variant",
      client: "requested-client-only",
      arm: "current",
      repetition: 1,
      attempt_id: `attempt-${index}`,
    },
  };
}
function report(
  input: CalibrationAdapterInput,
  first: "met" | "unmet" | "insufficient_evidence" | "not_applicable" = "met",
) {
  return {
    binding: input.binding,
    observations: input.public_rubric.criteria.map((criterion, index) => {
      const state = index === 0 ? first : "met";
      return {
        criterion_id: criterion.id,
        state,
        ...(state === "met" || state === "unmet"
          ? { value: state === "met" }
          : {}),
        evidence:
          state === "insufficient_evidence"
            ? []
            : [
                {
                  target_digest: input.binding.target_digest,
                  start: 0,
                  end: 1,
                  quote: input.target.content.slice(0, 1),
                },
              ],
        rationale: "Software control",
      };
    }),
  };
}
async function replay(
  f: Fixture,
  cases: readonly string[],
  adapter: (input: CalibrationAdapterInput, index: number) => Promise<unknown>,
  start = 0,
) {
  let index = 0;
  const run = await runGateCalibration({
    ...f,
    attempts: cases.map((id, i) => attempt(id, i + start)),
    adapter: (input) => adapter(input, index++),
  });
  return replayGateCalibration(f.archive, run.invocation_ref);
}
async function completed(input: CalibrationAdapterInput) {
  return { state: "completed", report: report(input) };
}

test("hand-calculated arithmetic retains errors and missing in all requested denominators", async () => {
  await withFixture(async (f) => {
    const actual = await replay(
      f,
      [
        "positive",
        "positive",
        "negative",
        "negative",
        "insufficient_evidence",
        "valid_alternative",
        "boundary",
        "boundary",
        "reserved",
      ],
      async (input, index) => {
        if (index === 5)
          return {
            state: "completed",
            report: { ...report(input), observations: [] },
          };
        if (index === 6) return { state: "error", code: "client_error" };
        if (index === 7) return { state: "incomplete", code: "timeout" };
        const state =
          index === 1 || index === 3
            ? "unmet"
            : index === 4
              ? "insufficient_evidence"
              : "met";
        return { state: "completed", report: report(input, state) };
      },
    );
    const projected = projectGateCalibration(actual, {
      requested: [
        ...actual.attempts.map(({ identity, case_id }) => ({
          identity,
          case_id,
        })),
        attempt("positive", 99),
      ],
    });
    assert.deepEqual(projected.confusion, {
      eligible_attempts: 4,
      requested_denominator: 10,
      true_positive: 1,
      false_positive: 1,
      true_negative: 1,
      false_negative: 1,
      false_acceptance: { count: 1, denominator: 2, rate: 0.5 },
      false_rejection: { count: 1, denominator: 2, rate: 0.5 },
    });
    assert.equal(projected.inventory_source, "caller_declared");
    assert.equal(projected.counts.requested_attempts, 10);
    assert.equal(projected.counts.recorded_attempts, 9);
    assert.equal(projected.counts.distinct_requested_cases, 6);
    assert.equal(projected.counts.extra_requested_attempts, 4);
    assert.equal(projected.counts.distinct_binary_graded_cases, 2);
    const expected = {
      accepted: 2,
      rejected: 2,
      insufficient_evidence: 1,
      invalid_report: 1,
      error: 1,
      incomplete: 1,
      unattempted: 1,
      missing: 1,
    };
    for (const [state, value] of Object.entries(projected.outcomes)) {
      assert.deepEqual(value, {
        count: expected[state as keyof typeof expected],
        denominator: 10,
        rate: expected[state as keyof typeof expected] / 10,
      });
    }
    assert.equal(
      Object.values(projected.outcomes).reduce(
        (sum, value) => sum + value.count,
        0,
      ),
      10,
    );
    assert.deepEqual(projected.criterion_state_comparison.criteria[0], {
      criterion_id: "action",
      compared: 5,
      matches: 3,
      mismatches: 2,
      correct_abstentions: 1,
      unavailable: 5,
      requested_denominator: 10,
    });
    assert.equal(projected.criterion_state_comparison.criteria[1]!.matches, 5);
    assert.equal(projected.scope, "semantic_components");
    assert.equal(projected.full_gate_acceptance.state, "not_assessed");
  });
});
test("all-fail outputs remain eligible false rejections with no success required", async () => {
  await withFixture(async (f) => {
    const actual = await replay(
      f,
      ["positive", "valid_alternative", "boundary"],
      async (input) => ({ state: "completed", report: report(input, "unmet") }),
    );
    const projected = projectGateCalibration(actual);
    assert.equal(projected.confusion.false_negative, 3);
    assert.deepEqual(projected.confusion.false_rejection, {
      count: 3,
      denominator: 3,
      rate: 1,
    });
    assert.deepEqual(projected.confusion.false_acceptance, {
      count: 0,
      denominator: 0,
      rate: null,
    });
    assert.equal(projected.outcomes.rejected.denominator, 3);
  });
});
test("no eligible judgments: correct abstentions cannot become true negatives", async () => {
  await withFixture(async (f) => {
    const actual = await replay(
      f,
      ["insufficient_evidence", "negative"],
      async (input) => ({
        state: "completed",
        report: report(input, "insufficient_evidence"),
      }),
    );
    const projected = projectGateCalibration(actual);
    assert.equal(projected.confusion.eligible_attempts, 0);
    assert.equal(projected.confusion.true_negative, 0);
    assert.equal(projected.confusion.false_acceptance.rate, null);
    assert.equal(projected.confusion.false_rejection.rate, null);
    assert.equal(projected.outcomes.insufficient_evidence.rate, 1);
    assert.equal(
      projected.criterion_state_comparison.criteria[0]!.correct_abstentions,
      1,
    );
    assert.equal(
      projected.criterion_state_comparison.criteria[0]!.mismatches,
      1,
    );
  });
});
test("default inventory separates unrequested suite cases from planned missing attempts", async () => {
  await withFixture(async (f) => {
    const actual = await replay(f, ["positive"], completed);
    const projected = projectGateCalibration(actual);
    assert.equal(projected.inventory_source, "verified_replay_manifest");
    assert.equal(projected.outcomes.missing.count, 0);
    assert.equal(projected.outcomes.missing.denominator, 1);
    assert.deepEqual(projected.unrequested_suite_cases, [
      "boundary",
      "insufficient_evidence",
      "negative",
      "reserved",
      "valid_alternative",
    ]);
    const missing = projectGateCalibration(actual, {
      requested: [attempt("positive", 0), attempt("negative", 8)],
    });
    assert.equal(missing.outcomes.missing.count, 1);
    assert.equal(missing.outcomes.missing.denominator, 2);
    assert.equal(missing.unrequested_suite_cases.includes("negative"), false);
  });
});
test("caller inventory refuses duplicate, malformed, unknown and extraneous identity/case bindings", async () => {
  await withFixture(async (f) => {
    const actual = await replay(f, ["positive"], completed);
    const chosen = attempt("positive", 0);
    assert.throws(
      () => projectGateCalibration(actual, { requested: [chosen, chosen] }),
      /duplicate requested identity/,
    );
    assert.throws(
      () =>
        projectGateCalibration(actual, { requested: [attempt("unknown", 0)] }),
      /unknown requested case/,
    );
    assert.throws(
      () => projectGateCalibration(actual, { requested: [] }),
      /extraneous grade/,
    );
    assert.throws(
      () =>
        projectGateCalibration(actual, {
          requested: null as unknown as readonly CalibrationAttempt[],
        }),
      /requires an array/,
    );
    assert.throws(
      () =>
        projectGateCalibration(actual, { requested: [attempt("negative", 0)] }),
      /case mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(actual, {
          requested: [
            { ...chosen, identity: { ...chosen.identity, repetition: 0 } },
          ],
        }),
      /positive safe integer/,
    );
    assert.throws(
      () =>
        projectGateCalibration(actual, {
          requested: [
            { ...chosen, identity: { ...chosen.identity, client: "" } },
          ],
        }),
      /nonempty/,
    );
    const extra = {
      ...chosen,
      identity: { ...chosen.identity, native_reviewer_id: "invented" },
    };
    assert.throws(
      () => projectGateCalibration(actual, { requested: [extra] }),
      /unsupported/,
    );
    const missing = {
      ...chosen,
      identity: { ...chosen.identity, arm: undefined },
    } as unknown as CalibrationAttempt;
    assert.throws(
      () => projectGateCalibration(actual, { requested: [missing] }),
      /lossless JSON|nonempty/,
    );
  });
});
test("modified grades cannot cross case, pins, trial, target or complete adjudication bindings", async () => {
  await withFixture(async (f) => {
    const actual = await replay(f, ["positive"], completed);
    const first = actual.attempts[0]!;
    const alter = (grade: typeof first.grade) => ({
      ...actual,
      attempts: [{ ...first, grade }],
    });
    assert.throws(
      () =>
        projectGateCalibration(alter({ ...first.grade, case_id: "negative" })),
      /grade case mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(
          alter({
            ...first.grade,
            pins: {
              ...first.grade.pins,
              evaluator_ref: first.grade.pins.gate_ref,
            },
          }),
        ),
      /pins mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(
          alter({
            ...first.grade,
            binding: { ...first.grade.binding, target_digest: "changed" },
          }),
        ),
      /binding mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(
          alter({ ...first.grade, trial_ref: first.grade_ref }),
        ),
      /trial mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(
          alter({
            ...first.grade,
            adjudication: { ...first.grade.adjudication!, criteria: [] },
          }),
        ),
      /incomplete criterion coverage/,
    );
    assert.throws(
      () =>
        projectGateCalibration(alter({ ...first.grade, status: "rejected" })),
      /status mismatch/,
    );
    assert.throws(
      () =>
        projectGateCalibration(
          { ...actual, attempts: [first, first] },
          { requested: [attempt("positive", 0)] },
        ),
      /duplicate graded identity/,
    );
  });
});
test("reserved requests never receive binary grades or criterion matches", async () => {
  await withFixture(async (f) => {
    let calls = 0;
    const actual = await replay(f, ["reserved"], async (input) => {
      calls++;
      return completed(input);
    });
    const projected = projectGateCalibration(actual);
    assert.equal(calls, 0);
    assert.equal(projected.outcomes.unattempted.rate, 1);
    assert.equal(projected.confusion.eligible_attempts, 0);
    assert.equal(projected.criterion_state_comparison.criteria[0]!.compared, 0);
    assert.deepEqual(projected.reserved_suite_cases, ["reserved"]);
    const first = actual.attempts[0]!;
    assert.throws(
      () =>
        projectGateCalibration({
          ...actual,
          attempts: [
            { ...first, grade: { ...first.grade, status: "accepted" } },
          ],
        }),
      /reserved case cannot be graded/,
    );
  });
});
test("unreviewed expected labels remain outside confusion and descriptive state matches", async () => {
  await withFixture(async (f) => {
    const projected = projectGateCalibration(
      await replay(f, ["positive"], completed),
    );
    assert.equal(projected.counts.unreviewed_label_attempts, 1);
    assert.equal(projected.outcomes.accepted.count, 1);
    assert.equal(projected.confusion.eligible_attempts, 0);
    assert.equal(
      projected.criterion_state_comparison.criteria[0]!.unavailable,
      1,
    );
  }, false);
});
test("repeat instability counts distinct cases, with errors and abstentions separate", async () => {
  await withFixture(async (f) => {
    const actual = await replay(
      f,
      [
        "positive",
        "positive",
        "positive",
        "positive",
        "positive",
        "negative",
        "negative",
      ],
      async (input, index) => {
        if (index === 3) return { state: "error", code: "timeout" };
        const state =
          index === 1
            ? "unmet"
            : index === 4
              ? "insufficient_evidence"
              : index >= 5
                ? "unmet"
                : "met";
        return { state: "completed", report: report(input, state) };
      },
    );
    const projected = projectGateCalibration(actual);
    assert.equal(projected.counts.distinct_requested_cases, 2);
    assert.equal(projected.counts.extra_requested_attempts, 5);
    assert.deepEqual(projected.repeats, [
      {
        case_id: "negative",
        requested_attempts: 2,
        binary_attempts: 2,
        extra_binary_attempts: 1,
        distinct_binary_outcomes: 1,
        unstable: false,
        abstentions: 0,
        other_outcomes: 0,
      },
      {
        case_id: "positive",
        requested_attempts: 5,
        binary_attempts: 3,
        extra_binary_attempts: 2,
        distinct_binary_outcomes: 2,
        unstable: true,
        abstentions: 1,
        other_outcomes: 1,
      },
    ]);
    assert.equal(projected.confusion.eligible_attempts, 5);
  });
});
test("N/A participates in descriptive comparisons, and binary repeat signatures retain criterion states", async () => {
  await withFixture(async (f) => {
    const projected = projectGateCalibration(
      await replay(f, ["positive", "positive"], async (input, index) => ({
        state: "completed",
        report: report(input, index === 0 ? "met" : "not_applicable"),
      })),
    );
    assert.equal(projected.confusion.true_positive, 2);
    assert.equal(projected.criterion_state_comparison.criteria[0]!.matches, 1);
    assert.equal(
      projected.criterion_state_comparison.criteria[0]!.mismatches,
      1,
    );
    assert.equal(projected.repeats[0]!.unstable, true);
  });
});
const observed = {
  provenance: "client_reported",
  provider: "supplied-provider",
  model: "supplied-model",
  revision: "supplied-revision",
  context: "self",
} as const;
test("complete reported configuration tuples group claims; reviewer independence remains unavailable", async () => {
  await withFixture(async (f) => {
    const projected = projectGateCalibration(
      await replay(
        f,
        ["positive", "positive", "positive", "positive"],
        async (input, index) => ({
          state: "completed",
          report: report(input, index === 1 ? "unmet" : "met"),
          observed: {
            ...observed,
            ...(index === 1
              ? { context: "separate_pass" }
              : index === 2
                ? { revision: undefined }
                : index === 3
                  ? { context: "unknown" }
                  : {}),
          },
        }),
      ),
    );
    // Explicit undefined is an invalid adapter result; it cannot be an observed configuration.
    assert.equal(projected.outcomes.error.count, 1);
    assert.equal(projected.reported_configurations.length, 2);
    assert.equal(
      projected.reported_configurations.reduce(
        (sum, group) => sum + group.attempts,
        0,
      ),
      2,
    );
    assert.deepEqual(projected.unknown_configuration_attempts, {
      count: 2,
      denominator: 4,
      rate: 0.5,
    });
    assert.deepEqual(projected.configuration_disagreement, {
      interpretation: "descriptive_client_reported_configuration_outcomes",
      compared_cases: 1,
      disagreeing_cases: 1,
      rate: 1,
    });
    assert.equal(projected.reviewer_disagreement.state, "unknown");
    assert.match(projected.reviewer_disagreement.reason, /instance IDs/);
  });
});
test("omitted revision/provider/model/context and unknown provenance do not inherit requested metadata", async () => {
  await withFixture(async (f) => {
    const partials = [
      {
        provenance: "client_reported",
        provider: "provider",
        model: "model",
        context: "self",
      },
      {
        provenance: "client_reported",
        provider: "provider",
        revision: "revision",
        context: "self",
      },
      {
        provenance: "client_reported",
        model: "model",
        revision: "revision",
        context: "self",
      },
      {
        provenance: "client_reported",
        provider: "provider",
        model: "model",
        revision: "revision",
      },
      { ...observed, provenance: "unknown" },
    ];
    const projected = projectGateCalibration(
      await replay(
        f,
        partials.map(() => "positive"),
        async (input, index) => ({
          state: "completed",
          report: report(input),
          observed: partials[index],
        }),
      ),
    );
    assert.equal(projected.reported_configurations.length, 0);
    assert.equal(projected.outcomes.accepted.count, 5);
    assert.equal(projected.unknown_configuration_attempts.rate, 1);
    assert.equal(projected.configuration_disagreement.rate, null);
    for (const value of [projected.timing, projected.usage, projected.cost]) {
      assert.equal(value.state, "unknown");
      assert.ok(value.reason.length > 0);
    }
    assert.equal(
      JSON.stringify(projected).includes("requested-client-only"),
      false,
    );
    assert.equal(
      JSON.stringify(projected).includes("must-not-be-observed"),
      false,
    );
  });
});
test("matching pins and target coverage permit comparison across arm identities without merging", async () => {
  await withFixture(async (f) => {
    const left = await replay(f, ["positive"], completed);
    const run = await runGateCalibration({
      ...f,
      attempts: [
        {
          ...attempt("positive", 9),
          identity: { ...attempt("positive", 9).identity, arm: "structured" },
        },
      ],
      adapter: completed,
    });
    const right = await replayGateCalibration(f.archive, run.invocation_ref);
    assert.deepEqual(
      compareGateCalibrationReports(
        projectGateCalibration(left),
        projectGateCalibration(right),
      ),
      { state: "compatible", changed_bindings: [] },
    );
    assert.equal(hashCanonical(left.pins), hashCanonical(right.pins));
  });
});
test("changed gate/suite/rubric/evaluator or selected targets explicitly make reports incompatible", async () => {
  await withFixture(async (f) => {
    const baseline = projectGateCalibration(
      await replay(f, ["positive"], completed),
    );
    const changedEvaluator = projectGateCalibration(
      await replay(
        { ...f, evaluator: { ...f.evaluator, revision: "2" } },
        ["positive"],
        completed,
        10,
      ),
    );
    assert.deepEqual(
      compareGateCalibrationReports(baseline, changedEvaluator),
      { state: "incompatible", changed_bindings: ["evaluator_ref"] },
    );
    for (const key of [
      "gate_ref",
      "suite_ref",
      "rubric_ref",
      "evaluator_ref",
    ] as const) {
      const changed = {
        ...baseline,
        pins: {
          ...baseline.pins,
          [key]: { ...baseline.pins[key], digest: `sha256:${"f".repeat(64)}` },
        },
      };
      assert.deepEqual(compareGateCalibrationReports(baseline, changed), {
        state: "incompatible",
        changed_bindings: [key],
      });
    }
    const differentCases = projectGateCalibration(
      await replay(f, ["negative"], completed, 20),
    );
    assert.deepEqual(compareGateCalibrationReports(baseline, differentCases), {
      state: "incompatible",
      changed_bindings: ["selected_target_coverage"],
    });
    const missingCoverage = projectGateCalibration(
      await replay(f, ["positive"], completed, 30),
      { requested: [attempt("positive", 30), attempt("negative", 31)] },
    );
    assert.deepEqual(compareGateCalibrationReports(baseline, missingCoverage), {
      state: "incompatible",
      changed_bindings: ["selected_target_coverage"],
    });
  });
});
test("projection leaves verified replay bytes unchanged", async () => {
  await withFixture(async (f) => {
    const actual: GateCalibrationReplay = await replay(
      f,
      ["positive"],
      completed,
    );
    const before = canonicalJson(actual);
    projectGateCalibration(actual);
    assert.equal(canonicalJson(actual), before);
  });
});
