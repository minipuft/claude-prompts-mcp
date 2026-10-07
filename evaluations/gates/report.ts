// Pure descriptive projection of replayGateCalibration's verified result; no archive I/O.
import { hashCanonical } from "../../server/src/shared/utils/hash.ts";
import { createArchiveRecord } from "../core/contracts.ts";
import type {
  CalibrationAttempt,
  CalibrationPins,
  CalibrationStatus,
  GateCalibrationReplay,
} from "./calibration.ts";
import type { GateSuiteCase } from "./contracts.ts";

type ReplayedAttempt = GateCalibrationReplay["attempts"][number];
type Outcome = CalibrationStatus | "missing";
type UnknownMeasurement = {
  readonly state: "unknown";
  readonly reason: string;
};
export interface RequestedRate {
  readonly count: number;
  readonly denominator: number;
  readonly rate: number | null;
}
export interface ReportedConfiguration {
  readonly provenance: "client_reported";
  readonly provider: string;
  readonly model: string;
  readonly revision: string;
  readonly context: "self" | "separate_pass" | "isolated_judge";
}
export interface CriterionStateComparison {
  readonly criterion_id: string;
  readonly compared: number;
  readonly matches: number;
  readonly mismatches: number;
  readonly correct_abstentions: number;
  readonly unavailable: number;
  readonly requested_denominator: number;
}
export interface CaseRepeatSummary {
  readonly case_id: string;
  readonly requested_attempts: number;
  readonly binary_attempts: number;
  readonly extra_binary_attempts: number;
  readonly distinct_binary_outcomes: number;
  readonly unstable: boolean | null;
  readonly abstentions: number;
  readonly other_outcomes: number;
}
export interface GateCalibrationReport {
  readonly scope: "semantic_components";
  readonly full_gate_acceptance: {
    readonly state: "not_assessed";
    readonly reason: string;
  };
  readonly inventory_source: "caller_declared" | "verified_replay_manifest";
  readonly pins: CalibrationPins;
  readonly selected_target_coverage: readonly {
    readonly case_id: string;
    readonly target_digest: string;
  }[];
  readonly counts: {
    readonly suite_cases: number;
    readonly requested_attempts: number;
    readonly recorded_attempts: number;
    readonly distinct_requested_cases: number;
    readonly extra_requested_attempts: number;
    readonly distinct_binary_graded_cases: number;
    readonly unreviewed_label_attempts: number;
  };
  readonly unrequested_suite_cases: readonly string[];
  readonly reserved_suite_cases: readonly string[];
  readonly outcomes: Readonly<Record<Outcome, RequestedRate>>;
  readonly confusion: {
    readonly eligible_attempts: number;
    readonly requested_denominator: number;
    readonly true_positive: number;
    readonly false_positive: number;
    readonly true_negative: number;
    readonly false_negative: number;
    readonly false_acceptance: RequestedRate;
    readonly false_rejection: RequestedRate;
  };
  readonly criterion_state_comparison: {
    readonly interpretation: "descriptive_expected_state_matches";
    readonly criteria: readonly CriterionStateComparison[];
  };
  readonly repeats: readonly CaseRepeatSummary[];
  readonly reported_configurations: readonly {
    readonly configuration: ReportedConfiguration;
    readonly attempts: number;
    readonly binary_attempts: number;
    readonly distinct_cases: number;
  }[];
  readonly unknown_configuration_attempts: RequestedRate;
  readonly configuration_disagreement: {
    readonly interpretation: "descriptive_client_reported_configuration_outcomes";
    readonly compared_cases: number;
    readonly disagreeing_cases: number;
    readonly rate: number | null;
  };
  readonly reviewer_disagreement: UnknownMeasurement;
  readonly timing: UnknownMeasurement;
  readonly usage: UnknownMeasurement;
  readonly cost: UnknownMeasurement;
}
const outcomeNames: readonly Outcome[] = [
  "accepted",
  "rejected",
  "insufficient_evidence",
  "invalid_report",
  "error",
  "incomplete",
  "unattempted",
  "missing",
];
function fail(message: string): never {
  throw new TypeError(`gate calibration report: ${message}`);
}
function same(actual: unknown, expected: unknown, message: string): void {
  if (hashCanonical(actual) !== hashCanonical(expected)) fail(message);
}
function ratio(count: number, denominator: number): RequestedRate {
  return {
    count,
    denominator,
    rate: denominator === 0 ? null : count / denominator,
  };
}
function unknown(reason: string): UnknownMeasurement {
  return { state: "unknown", reason };
}
// Reuse the archive's canonical seven-part identity validator, without publishing anything.
function identityKey(
  attempt: CalibrationAttempt,
  pins: CalibrationPins,
): string {
  createArchiveRecord({
    schema_version: 1,
    kind: "trial",
    identity: attempt.identity,
    provenance: {
      adapter: { id: "gate-report-projection", version: "1" },
      source: { id: "verified-replay", version: "1" },
      refs: [pins.suite_ref],
    },
    refs: [],
    payload: {},
  });
  return hashCanonical(attempt.identity);
}
function inventory(
  replay: GateCalibrationReplay,
  requested: readonly CalibrationAttempt[],
) {
  if (!Array.isArray(requested)) fail("requested inventory requires an array");
  const cases = new Map(
    replay.suite.payload.cases.map((item) => [item.case_id, item]),
  );
  const indexed = new Map<string, CalibrationAttempt>();
  for (const attempt of requested) {
    if (!attempt || Object.keys(attempt).sort().join() !== "case_id,identity")
      fail("requested inventory requires only identity and case_id");
    if (typeof attempt.case_id !== "string" || !cases.has(attempt.case_id))
      fail("unknown requested case");
    const key = identityKey(attempt, replay.pins);
    if (indexed.has(key)) fail("duplicate requested identity");
    indexed.set(key, attempt);
  }
  return { cases, indexed };
}
function validateGrade(
  replay: GateCalibrationReplay,
  attempt: ReplayedAttempt,
  item: GateSuiteCase,
): void {
  const grade = attempt.grade;
  same(grade.case_id, attempt.case_id, "grade case mismatch");
  same(grade.pins, replay.pins, "grade pins mismatch");
  same(grade.trial_ref, attempt.trial_ref, "grade trial mismatch");
  same(
    grade.binding,
    {
      gate_id: replay.suite.payload.gate_id,
      definition_digest: replay.suite.payload.definition_digest,
      target_digest: item.target_ref.digest,
      node_id: attempt.identity.task_id,
      attempt_id: hashCanonical({
        identity: attempt.identity,
        case_id: attempt.case_id,
        pins: replay.pins,
      }),
    },
    "grade binding mismatch",
  );
  if (!outcomeNames.slice(0, -1).includes(grade.status))
    fail("unknown grade status");
  if (item.exposure === "reserved" && grade.status !== "unattempted")
    fail("reserved case cannot be graded");
  if (isBinary(attempt) || grade.status === "insufficient_evidence")
    validateComplete(replay, attempt);
}
function validateComplete(
  replay: GateCalibrationReplay,
  attempt: ReplayedAttempt,
): void {
  const result = attempt.grade.adjudication;
  if (
    !result?.valid ||
    !attempt.grade.raw_report_ref ||
    attempt.grade.error !== null
  )
    fail("completed grade requires valid adjudication and report");
  same(
    result.criteria.map((item) => item.criterion_id),
    replay.suite.payload.criterion_ids,
    "incomplete criterion coverage",
  );
  if (result.criteria.some((item) => !item.valid || item.state === "invalid"))
    fail("invalid completed criterion");
  const expectedStatus = result.passed
    ? "accepted"
    : result.criteria.some((item) => item.state === "insufficient_evidence")
      ? "insufficient_evidence"
      : "rejected";
  same(attempt.grade.status, expectedStatus, "grade status mismatch");
}
function indexGrades(
  replay: GateCalibrationReplay,
  requested: Map<string, CalibrationAttempt>,
  cases: Map<string, GateSuiteCase>,
) {
  const grades = new Map<string, ReplayedAttempt>();
  for (const attempt of replay.attempts) {
    const key = identityKey(attempt, replay.pins);
    const selected = requested.get(key);
    if (!selected) fail("extraneous grade outside requested inventory");
    if (selected.case_id !== attempt.case_id)
      fail("requested/graded case mismatch");
    if (grades.has(key)) fail("duplicate graded identity");
    const item = cases.get(attempt.case_id);
    if (!item) fail("unknown graded case");
    validateGrade(replay, attempt, item);
    grades.set(key, attempt);
  }
  return grades;
}
function isBinary(attempt: ReplayedAttempt): boolean {
  return (
    attempt.grade.status === "accepted" || attempt.grade.status === "rejected"
  );
}
function binarySignature(attempt: ReplayedAttempt): string {
  return hashCanonical({
    status: attempt.grade.status,
    criteria: attempt.grade.adjudication!.criteria.map(
      ({ criterion_id, state }) => ({ criterion_id, state }),
    ),
  });
}
function confusion(
  attempts: readonly ReplayedAttempt[],
  cases: Map<string, GateSuiteCase>,
  denominator: number,
) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const attempt of attempts) {
    const selected = cases.get(attempt.case_id)!;
    if (
      !isBinary(attempt) ||
      selected.label_review.state !== "reviewed" ||
      selected.exposure === "reserved"
    )
      continue;
    if (attempt.grade.status === "accepted") {
      if (selected.expected_acceptance) tp++;
      else fp++;
    } else if (selected.expected_acceptance) fn++;
    else tn++;
  }
  return {
    eligible_attempts: tp + fp + tn + fn,
    requested_denominator: denominator,
    true_positive: tp,
    false_positive: fp,
    true_negative: tn,
    false_negative: fn,
    false_acceptance: ratio(fp, fp + tn),
    false_rejection: ratio(fn, tp + fn),
  };
}
function criterionComparisons(
  replay: GateCalibrationReplay,
  denominator: number,
): CriterionStateComparison[] {
  return replay.suite.payload.criterion_ids.map((criterion_id) => {
    let matches = 0,
      mismatches = 0,
      correct_abstentions = 0;
    for (const attempt of replay.attempts) {
      const selected = replay.suite.payload.cases.find(
        (item) => item.case_id === attempt.case_id,
      )!;
      if (
        selected.label_review.state !== "reviewed" ||
        selected.exposure === "reserved" ||
        !attempt.grade.adjudication?.valid
      )
        continue;
      const actual = attempt.grade.adjudication.criteria.find(
        (item) => item.criterion_id === criterion_id,
      );
      if (!actual?.valid) continue;
      if (actual.state === selected.expected_criterion_states[criterion_id]) {
        matches++;
        if (actual.state === "insufficient_evidence") correct_abstentions++;
      } else mismatches++;
    }
    const compared = matches + mismatches;
    return {
      criterion_id,
      compared,
      matches,
      mismatches,
      correct_abstentions,
      unavailable: denominator - compared,
      requested_denominator: denominator,
    };
  });
}
function repeatSummaries(
  requested: readonly CalibrationAttempt[],
  attempts: readonly ReplayedAttempt[],
): CaseRepeatSummary[] {
  const ids = [...new Set(requested.map((item) => item.case_id))].sort();
  return ids.map((case_id) => {
    const all = attempts.filter((item) => item.case_id === case_id);
    const binary = all.filter(isBinary);
    const signatures = new Set(binary.map(binarySignature));
    const total = requested.filter((item) => item.case_id === case_id).length;
    const abstentions = all.filter(
      (item) => item.grade.status === "insufficient_evidence",
    ).length;
    return {
      case_id,
      requested_attempts: total,
      binary_attempts: binary.length,
      extra_binary_attempts: Math.max(0, binary.length - 1),
      distinct_binary_outcomes: signatures.size,
      unstable: binary.length < 2 ? null : signatures.size > 1,
      abstentions,
      other_outcomes: total - binary.length - abstentions,
    };
  });
}
function reportedConfiguration(
  attempt: ReplayedAttempt,
): ReportedConfiguration | null {
  const observed = attempt.grade.observed;
  if (
    observed.provenance !== "client_reported" ||
    !observed.provider ||
    !observed.model ||
    !observed.revision ||
    !observed.context ||
    observed.context === "unknown"
  )
    return null;
  return {
    provenance: "client_reported",
    provider: observed.provider,
    model: observed.model,
    revision: observed.revision,
    context: observed.context,
  };
}
function configurationSummary(attempts: readonly ReplayedAttempt[]) {
  const groups = new Map<
    string,
    { configuration: ReportedConfiguration; attempts: ReplayedAttempt[] }
  >();
  const byCase = new Map<string, Map<string, Set<string>>>();
  let unknownCount = 0;
  for (const attempt of attempts) {
    const configuration = reportedConfiguration(attempt);
    if (!configuration) {
      unknownCount++;
      continue;
    }
    const key = hashCanonical(configuration);
    const group = groups.get(key) ?? { configuration, attempts: [] };
    group.attempts.push(attempt);
    groups.set(key, group);
    if (isBinary(attempt)) addConfigurationOutcome(byCase, attempt, key);
  }
  const compared = [...byCase.values()].filter((items) => items.size > 1);
  const disagreeing = compared.filter(
    (items) =>
      new Set([...items.values()].flatMap((values) => [...values])).size > 1,
  ).length;
  return {
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => ({
        configuration: group.configuration,
        attempts: group.attempts.length,
        binary_attempts: group.attempts.filter(isBinary).length,
        distinct_cases: new Set(group.attempts.map((item) => item.case_id))
          .size,
      })),
    unknownCount,
    disagreement: {
      interpretation:
        "descriptive_client_reported_configuration_outcomes" as const,
      compared_cases: compared.length,
      disagreeing_cases: disagreeing,
      rate: ratio(disagreeing, compared.length).rate,
    },
  };
}
function addConfigurationOutcome(
  byCase: Map<string, Map<string, Set<string>>>,
  attempt: ReplayedAttempt,
  key: string,
): void {
  const configurations =
    byCase.get(attempt.case_id) ?? new Map<string, Set<string>>();
  const outcomes = configurations.get(key) ?? new Set<string>();
  outcomes.add(binarySignature(attempt));
  configurations.set(key, outcomes);
  byCase.set(attempt.case_id, configurations);
}
/** Caller must supply replayGateCalibration's verified output, not unverified grade records. */
export function projectGateCalibration(
  replay: GateCalibrationReplay,
  options: { readonly requested?: readonly CalibrationAttempt[] } = {},
): GateCalibrationReport {
  const requested =
    options.requested === undefined
      ? replay.attempts.map(({ identity, case_id }) => ({ identity, case_id }))
      : options.requested;
  const { cases, indexed } = inventory(replay, requested);
  const grades = indexGrades(replay, indexed, cases);
  const total = requested.length;
  const selected = [...new Set(requested.map((item) => item.case_id))].sort();
  const statuses = [...indexed.keys()].map(
    (key) => grades.get(key)?.grade.status ?? "missing",
  );
  const configuration = configurationSummary(replay.attempts);
  return {
    scope: "semantic_components",
    full_gate_acceptance: {
      state: "not_assessed",
      reason: "runtime enforcement and nonsemantic components are not assessed",
    },
    inventory_source:
      options.requested === undefined
        ? "verified_replay_manifest"
        : "caller_declared",
    pins: replay.pins,
    selected_target_coverage: selected.map((case_id) => ({
      case_id,
      target_digest: cases.get(case_id)!.target_ref.digest,
    })),
    counts: {
      suite_cases: cases.size,
      requested_attempts: total,
      recorded_attempts: grades.size,
      distinct_requested_cases: selected.length,
      extra_requested_attempts: total - selected.length,
      distinct_binary_graded_cases: new Set(
        replay.attempts.filter(isBinary).map((item) => item.case_id),
      ).size,
      unreviewed_label_attempts: requested.filter(
        (item) => cases.get(item.case_id)!.label_review.state !== "reviewed",
      ).length,
    },
    unrequested_suite_cases: [...cases.keys()]
      .filter((id) => !selected.includes(id))
      .sort(),
    reserved_suite_cases: [...cases.values()]
      .filter((item) => item.exposure === "reserved")
      .map((item) => item.case_id)
      .sort(),
    outcomes: Object.fromEntries(
      outcomeNames.map((name) => [
        name,
        ratio(statuses.filter((status) => status === name).length, total),
      ]),
    ) as Record<Outcome, RequestedRate>,
    confusion: confusion(replay.attempts, cases, total),
    criterion_state_comparison: {
      interpretation: "descriptive_expected_state_matches",
      criteria: criterionComparisons(replay, total),
    },
    repeats: repeatSummaries(requested, replay.attempts),
    reported_configurations: configuration.groups,
    unknown_configuration_attempts: ratio(
      configuration.unknownCount + total - grades.size,
      total,
    ),
    configuration_disagreement: configuration.disagreement,
    reviewer_disagreement: unknown(
      "no reviewer instance IDs or independently verified native identity in this contract",
    ),
    timing: unknown("verified replay supplies no measured timing"),
    usage: unknown("verified replay supplies no whole-attempt usage receipts"),
    cost: unknown("verified replay supplies no whole-attempt cost receipts"),
  };
}

/** Exact bindings/selected targets only. Compatible does not imply independent model evidence. */
export function compareGateCalibrationReports(
  left: GateCalibrationReport,
  right: GateCalibrationReport,
): {
  readonly state: "compatible" | "incompatible";
  readonly changed_bindings: readonly string[];
} {
  const changed: string[] = [];
  for (const key of [
    "gate_ref",
    "suite_ref",
    "rubric_ref",
    "evaluator_ref",
  ] as const) {
    if (hashCanonical(left.pins[key]) !== hashCanonical(right.pins[key]))
      changed.push(key);
  }
  if (
    hashCanonical(left.selected_target_coverage) !==
    hashCanonical(right.selected_target_coverage)
  )
    changed.push("selected_target_coverage");
  return {
    state: changed.length === 0 ? "compatible" : "incompatible",
    changed_bindings: changed,
  };
}
