// Explicit offline invocation/replay only; caller owns client execution and deadlines.
import { SemanticCriterionSchema } from "../../server/src/engine/gates/core/gate-schema.ts";
import { evaluateSemanticEvaluation } from "../../server/src/engine/gates/core/semantic-evaluation.ts";
import type {
  PinnedSemanticEvaluationContext,
  SemanticEvaluationBinding,
  SemanticEvaluationReport,
} from "../../server/src/shared/types/gate-evaluation.ts";
import {
  canonicalJson,
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { createArchiveRecord, parseContentRef } from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";
import { parseGateSuiteRecord, projectGateSuiteCase } from "./contracts.ts";
import type { GateSuiteRecord, PublicGateRubric } from "./contracts.ts";

type BlobRef = Extract<ContentRef, { type: "blob" }>;
type RecordRef = Extract<ContentRef, { type: "record" }>;
type Identity = NonNullable<ArchiveRecord["identity"]>;
type Adjudication = ReturnType<typeof evaluateSemanticEvaluation>;
type ObservedEvaluator = NonNullable<SemanticEvaluationReport["reviewer"]>;
export interface CalibrationEvaluator {
  readonly id: string;
  readonly revision: string;
  readonly configuration: ArchiveRecord["payload"];
}
export interface CalibrationAttempt {
  readonly identity: Identity;
  readonly case_id: string;
}
export interface CalibrationAdapterInput {
  readonly target: { readonly content: string; readonly ref: BlobRef };
  readonly public_rubric: PublicGateRubric;
  readonly binding: SemanticEvaluationBinding;
}
export type CalibrationAdapterResult = (
  | { readonly state: "completed"; readonly report: unknown }
  | {
      readonly state: "incomplete";
      readonly code: "timeout" | "cancelled" | "no_report";
    }
  | { readonly state: "error"; readonly code: "client_error" | "timeout" }
) & {
  readonly observed?: ObservedEvaluator;
  readonly artifact_refs?: readonly ContentRef[];
};
export interface CalibrationPins {
  readonly suite_ref: RecordRef;
  readonly gate_ref: BlobRef;
  readonly rubric_ref: BlobRef;
  readonly evaluator_ref: BlobRef;
}
export type CalibrationStatus =
  | "accepted"
  | "rejected"
  | "insufficient_evidence"
  | "invalid_report"
  | "error"
  | "incomplete"
  | "unattempted";
export interface CalibrationGrade {
  readonly type: "gate_calibration_grade";
  readonly scope: "semantic_components";
  readonly gate_acceptance: {
    readonly state: "not_assessed";
    readonly reason: string;
  };
  readonly case_id: string;
  readonly pins: CalibrationPins;
  readonly binding: SemanticEvaluationBinding;
  readonly trial_ref: RecordRef;
  readonly status: CalibrationStatus;
  readonly observed: ObservedEvaluator;
  readonly artifact_refs: readonly ContentRef[];
  readonly raw_report_ref: BlobRef | null;
  readonly adjudication: Adjudication | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}
export interface CalibrationAttemptRefs extends CalibrationAttempt {
  readonly trial_ref: RecordRef;
  readonly grade_ref: RecordRef;
}
export interface GateCalibrationRun {
  readonly invocation_ref: RecordRef;
  readonly started_ref: RecordRef;
  readonly attempts: readonly CalibrationAttemptRefs[];
}
export interface GateCalibrationReplay {
  readonly suite: GateSuiteRecord;
  readonly public_rubric: PublicGateRubric;
  readonly evaluator: CalibrationEvaluator;
  readonly pins: CalibrationPins;
  readonly attempts: readonly (CalibrationAttemptRefs & {
    readonly grade: CalibrationGrade;
    readonly report: unknown;
  })[];
}
const provenance: ArchiveRecord["provenance"] = {
  adapter: { id: "gate-calibration", version: "1" },
  source: { id: "canonical-semantic-evaluation", version: "1" },
  refs: [],
};
function fail(message: string): never {
  throw new TypeError(`gate calibration: ${message}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected object");
  return value as Record<string, unknown>;
}
function shape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const data = object(value);
  if (
    required.some((key) => !Object.hasOwn(data, key)) ||
    Object.keys(data).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    fail("unsupported or missing fields");
  return data;
}
function nonempty(value: unknown): void {
  if (typeof value !== "string" || !value.trim())
    fail("expected nonempty identifier");
}
// The archive's lossless JSON validation and detached recursive freeze remain the authority.
function frozen<T>(value: T): T {
  const record = createArchiveRecord({
    schema_version: 1,
    kind: "evidence",
    provenance: {
      ...provenance,
      refs: [
        {
          type: "blob",
          media_type: "application/json",
          digest: hashBytes("snapshot") as ContentRef["digest"],
        },
      ],
    },
    refs: [],
    payload: { value } as ArchiveRecord["payload"],
  });
  return record.payload["value"] as T;
}
function recordRef(record: ArchiveRecord): RecordRef {
  return parseContentRef({
    type: "record",
    kind: record.kind,
    digest: record.record_id,
  }) as RecordRef;
}
function envelope(
  kind: "trial" | "grade",
  identity: Identity,
  refs: readonly ContentRef[],
  payload: unknown,
): ArchiveRecord {
  return createArchiveRecord({
    schema_version: 1,
    kind,
    identity,
    provenance: { ...provenance, refs },
    refs,
    payload: payload as ArchiveRecord["payload"],
  });
}
function manifest(
  refs: readonly ContentRef[],
  payload: unknown,
): ArchiveRecord {
  return createArchiveRecord({
    schema_version: 1,
    kind: "evidence",
    provenance: { ...provenance, refs },
    refs,
    payload: payload as ArchiveRecord["payload"],
  });
}
function pinRefs(pins: CalibrationPins): ContentRef[] {
  return [pins.suite_ref, pins.gate_ref, pins.rubric_ref, pins.evaluator_ref];
}
function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
async function jsonBlob(
  archive: EvaluationArchive,
  value: unknown,
): Promise<BlobRef> {
  return archive.putBlob(
    Buffer.from(canonicalJson(frozen(value)), "utf8"),
    "application/json",
  );
}
async function readJson(
  archive: EvaluationArchive,
  ref: BlobRef,
): Promise<unknown> {
  const bytes = await archive.getBlob(ref);
  const value: unknown = JSON.parse(utf8(bytes));
  const detached = frozen(value);
  if (!bytes.equals(Buffer.from(canonicalJson(detached), "utf8")))
    fail("snapshot/report requires canonical JSON bytes");
  return detached;
}
/** Relations against an already resolved public gate, not a second gate definition schema. */
async function evaluateSnapshot(
  archive: EvaluationArchive,
  ref: BlobRef,
  publicRubric: PublicGateRubric,
): Promise<void> {
  if (ref.digest !== publicRubric.definition_digest)
    fail("gate snapshot digest mismatch");
  const gate = object(await readJson(archive, ref));
  if (
    Object.hasOwn(gate, "sourceRoot") ||
    gate["id"] !== publicRubric.gate_id ||
    typeof gate["guidance"] !== "string"
  )
    fail("resolved public gate snapshot mismatch");
  const evaluation = object(gate["evaluation"]);
  if (!["self", "judge"].includes(String(evaluation["mode"])))
    fail("effective evaluation mode required");
  if (
    (Object.hasOwn(evaluation, "model") &&
      typeof evaluation["model"] !== "string") ||
    (Object.hasOwn(evaluation, "strict") &&
      typeof evaluation["strict"] !== "boolean")
  )
    fail("invalid effective evaluation metadata");
  const criteria = gate["pass_criteria"];
  if (!Array.isArray(criteria)) fail("public gate pass_criteria required");
  const semantic = criteria
    .filter((item) => object(item)["type"] === "semantic_evaluation")
    .map((item) => SemanticCriterionSchema.parse(item));
  if (hashCanonical(semantic) !== hashCanonical(publicRubric.criteria))
    fail("public rubric differs from resolved gate criteria");
}
function evaluator(value: CalibrationEvaluator): CalibrationEvaluator {
  shape(value, ["id", "revision", "configuration"]);
  nonempty(value.id);
  nonempty(value.revision);
  object(value.configuration);
  return frozen(value);
}
function prepare(
  suiteValue: GateSuiteRecord,
  rubricValue: PublicGateRubric,
  requested: readonly CalibrationAttempt[],
) {
  const suite = parseGateSuiteRecord(suiteValue, rubricValue);
  const publicRubric = frozen({
    ...rubricValue,
    criteria: rubricValue.criteria.map((item) =>
      SemanticCriterionSchema.parse(item),
    ),
  });
  const attempts = frozen(requested);
  if (!Array.isArray(attempts) || attempts.length === 0)
    fail("explicit attempts required");
  const seen = new Set<string>();
  for (const attempt of attempts) {
    shape(attempt, ["identity", "case_id"]);
    nonempty(attempt.case_id);
    envelope("trial", attempt.identity, [recordRef(suite)], {});
    const id = hashCanonical(attempt.identity);
    if (seen.has(id)) fail("duplicate requested identity");
    seen.add(id);
    if (!suite.payload.cases.some((item) => item.case_id === attempt.case_id))
      fail("unknown requested case");
  }
  return { suite, publicRubric, attempts };
}
function binding(
  attempt: CalibrationAttempt,
  pins: CalibrationPins,
  suite: GateSuiteRecord,
): SemanticEvaluationBinding {
  const item = suite.payload.cases.find(
    (item) => item.case_id === attempt.case_id,
  )!;
  return frozen({
    gate_id: suite.payload.gate_id,
    definition_digest: suite.payload.definition_digest,
    target_digest: item.target_ref.digest,
    node_id: attempt.identity.task_id,
    attempt_id: hashCanonical({
      identity: attempt.identity,
      case_id: attempt.case_id,
      pins,
    }),
  });
}
function context(
  publicRubric: PublicGateRubric,
  bound: SemanticEvaluationBinding,
  content: string,
): PinnedSemanticEvaluationContext {
  return frozen({
    criteria: publicRubric.criteria,
    binding: bound,
    target: { kind: "step_output" as const, content },
  });
}
function observed(value: unknown): ObservedEvaluator {
  if (value === undefined) return { provenance: "unknown" };
  const data = shape(
    value,
    ["provenance"],
    ["provider", "model", "revision", "context"],
  );
  if (!["unknown", "client_reported"].includes(String(data["provenance"])))
    fail("observed evaluator must be unknown or client_reported");
  for (const key of ["provider", "model", "revision"])
    if (Object.hasOwn(data, key)) nonempty(data[key]);
  if (
    Object.hasOwn(data, "context") &&
    !["self", "separate_pass", "isolated_judge", "unknown"].includes(
      String(data["context"]),
    )
  )
    fail("invalid observed context");
  return value as ObservedEvaluator;
}
function adapterResult(value: unknown): CalibrationAdapterResult {
  const result = frozen(value);
  const data = object(result);
  shape(
    data,
    ["state", data["state"] === "completed" ? "report" : "code"],
    ["observed", "artifact_refs"],
  );
  if (!["completed", "incomplete", "error"].includes(String(data["state"])))
    fail("invalid adapter state");
  if (data["state"] !== "completed") {
    const codes =
      data["state"] === "incomplete"
        ? ["timeout", "cancelled", "no_report"]
        : ["client_error", "timeout"];
    if (!codes.includes(String(data["code"])))
      fail("invalid adapter outcome code");
  }
  observed(data["observed"]);
  if (Object.hasOwn(data, "artifact_refs")) {
    if (!Array.isArray(data["artifact_refs"]))
      fail("artifact refs require array");
    data["artifact_refs"].forEach(parseContentRef);
  }
  return result as CalibrationAdapterResult;
}
function status(result: Adjudication): CalibrationStatus {
  if (!result.valid) return "invalid_report";
  if (result.passed) return "accepted";
  return result.criteria.some((item) => item.state === "insufficient_evidence")
    ? "insufficient_evidence"
    : "rejected";
}
function errorGrade(
  base: Omit<CalibrationGrade, "status" | "error">,
  code: string,
  state: "error" | "unattempted" = "error",
): CalibrationGrade {
  return {
    ...base,
    status: state,
    error: {
      code,
      message:
        state === "unattempted"
          ? "case was not attempted"
          : "calibration attempt failed",
    },
  };
}
async function invoke(
  archive: EvaluationArchive,
  request: {
    readonly suite: GateSuiteRecord;
    readonly publicRubric: PublicGateRubric;
    readonly attempt: CalibrationAttempt;
    readonly pins: CalibrationPins;
    readonly trialRef: RecordRef;
  },
  adapter: (input: CalibrationAdapterInput) => Promise<unknown>,
): Promise<CalibrationGrade> {
  const { suite, publicRubric, attempt, pins, trialRef } = request;
  const bound = binding(attempt, pins, suite);
  const base = {
    type: "gate_calibration_grade" as const,
    scope: "semantic_components" as const,
    gate_acceptance: {
      state: "not_assessed" as const,
      reason: "runtime enforcement and nonsemantic components are not assessed",
    },
    case_id: attempt.case_id,
    pins,
    binding: bound,
    trial_ref: trialRef,
    observed: { provenance: "unknown" as const },
    artifact_refs: [],
    raw_report_ref: null,
    adjudication: null,
  };
  const selected = suite.payload.cases.find(
    (item) => item.case_id === attempt.case_id,
  )!;
  if (selected.exposure === "reserved")
    return errorGrade(base, "reserved_case", "unattempted");
  if (publicRubric.criteria.some((item) => item.target.kind !== "step_output"))
    return errorGrade(base, "unsupported_target", "unattempted");
  const projection = projectGateSuiteCase(suite, attempt.case_id, publicRubric);
  const bytes = await archive.getBlob(projection.target_ref); // Archive errors are fatal, outside callback catches.
  let content: string;
  try {
    content = utf8(bytes);
  } catch {
    return errorGrade(base, "invalid_utf8");
  }
  if (hashBytes(content) !== bound.target_digest)
    return errorGrade(base, "invalid_utf8");
  const pinned = context(publicRubric, bound, content);
  const input = frozen({
    target: { content, ref: projection.target_ref },
    public_rubric: projection.public_rubric,
    binding: bound,
  });
  let returned: unknown;
  try {
    returned = await adapter(input);
  } catch {
    return errorGrade(base, "adapter_exception");
  }
  let result: CalibrationAdapterResult;
  try {
    result = adapterResult(returned);
  } catch {
    return errorGrade(base, "invalid_adapter_result");
  }
  const details = {
    ...base,
    observed: observed(result.observed),
    artifact_refs: result.artifact_refs ?? [],
  };
  if (result.state !== "completed")
    return {
      ...details,
      status: result.state,
      error: {
        code: result.code,
        message: "adapter did not complete a report",
      },
    };
  const reportRef = await jsonBlob(archive, result.report);
  const adjudication = evaluateSemanticEvaluation(pinned, result.report);
  return {
    ...details,
    status: status(adjudication),
    raw_report_ref: reportRef,
    adjudication,
    error: null,
  };
}
async function refuseExistingStart(
  archive: EvaluationArchive,
  record: ArchiveRecord,
): Promise<void> {
  try {
    await archive.getRecord(recordRef(record));
  } catch (error) {
    if (
      error instanceof Error &&
      error.cause &&
      typeof error.cause === "object" &&
      "code" in error.cause &&
      error.cause.code === "ENOENT"
    )
      return;
    throw error;
  }
  fail(
    "exact requested attempt already started; allocate a new attempt identity",
  );
}

/** Every accepted request gets immutable starts before the first callback; no global identity index. */
export async function runGateCalibration(input: {
  readonly archive: EvaluationArchive;
  readonly suite: GateSuiteRecord;
  readonly public_rubric: PublicGateRubric;
  readonly gate_snapshot: BlobRef;
  readonly evaluator: CalibrationEvaluator;
  readonly attempts: readonly CalibrationAttempt[];
  readonly adapter: (input: CalibrationAdapterInput) => Promise<unknown>;
}): Promise<GateCalibrationRun> {
  const prepared = prepare(input.suite, input.public_rubric, input.attempts);
  const configured = evaluator(input.evaluator);
  const gateRef = parseContentRef(input.gate_snapshot);
  if (gateRef.type !== "blob") fail("gate snapshot requires blob ref");
  const adapter = input.adapter;
  if (typeof adapter !== "function") fail("callback adapter required");
  const archive = input.archive;
  await evaluateSnapshot(archive, gateRef, prepared.publicRubric);
  const pins: CalibrationPins = frozen({
    suite_ref: await archive.putRecord(prepared.suite),
    gate_ref: gateRef,
    rubric_ref: await jsonBlob(archive, prepared.publicRubric),
    evaluator_ref: await jsonBlob(archive, configured),
  });
  const starts = prepared.attempts.map((attempt) =>
    envelope("trial", attempt.identity, pinRefs(pins), {
      type: "gate_calibration_trial",
      phase: "started",
      case_id: attempt.case_id,
      pins,
      binding: binding(attempt, pins, prepared.suite),
    }),
  );
  for (const start of starts) await refuseExistingStart(archive, start);
  const trials: RecordRef[] = [];
  for (const start of starts) trials.push(await archive.putRecord(start));
  const requests = prepared.attempts.map((attempt, index) => ({
    ...attempt,
    trial_ref: trials[index]!,
  }));
  const startedRef = await archive.putRecord(
    manifest([...pinRefs(pins), ...trials], {
      type: "gate_calibration_invocation",
      phase: "started",
      pins,
      attempts: requests,
    }),
  );
  const results: CalibrationAttemptRefs[] = [];
  for (const request of requests) {
    const grade = await invoke(
      archive,
      {
        suite: prepared.suite,
        publicRubric: prepared.publicRubric,
        attempt: request,
        pins,
        trialRef: request.trial_ref,
      },
      adapter,
    );
    const refs = [
      ...pinRefs(pins),
      request.trial_ref,
      ...grade.artifact_refs,
      ...(grade.raw_report_ref ? [grade.raw_report_ref] : []),
    ];
    const gradeRef = await archive.putRecord(
      envelope("grade", request.identity, refs, grade),
    );
    results.push({ ...request, grade_ref: gradeRef });
  }
  const invocationRef = await archive.putRecord(
    manifest(
      [
        ...pinRefs(pins),
        startedRef,
        ...results.flatMap((item) => [item.trial_ref, item.grade_ref]),
      ],
      {
        type: "gate_calibration_invocation",
        phase: "completed",
        pins,
        started_ref: startedRef,
        attempts: results,
      },
    ),
  );
  return frozen({
    invocation_ref: invocationRef,
    started_ref: startedRef,
    attempts: results,
  });
}

async function resolveClosure(
  archive: EvaluationArchive,
  refs: readonly ContentRef[],
  seen = new Set<string>(),
): Promise<void> {
  for (const value of refs) {
    const ref = parseContentRef(value);
    const key = hashCanonical(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.type === "blob") await archive.getBlob(ref);
    else {
      const record = await archive.getRecord(ref);
      await resolveClosure(
        archive,
        [
          ...record.refs,
          ...record.provenance.refs,
          ...(record.usage.state === "known" ? [record.usage.source] : []),
          ...(record.cost.state === "known" ? [record.cost.source] : []),
        ],
        seen,
      );
    }
  }
}
function same(actual: unknown, expected: unknown): void {
  if (hashCanonical(actual) !== hashCanonical(expected))
    fail("replay identity/binding/adjudication mismatch");
}
function parsePins(value: unknown): CalibrationPins {
  const data = shape(value, [
    "suite_ref",
    "gate_ref",
    "rubric_ref",
    "evaluator_ref",
  ]);
  for (const key of ["suite_ref", "gate_ref", "rubric_ref", "evaluator_ref"]) {
    const ref = parseContentRef(data[key]);
    if (
      key === "suite_ref"
        ? ref.type !== "record" || ref.kind !== "suite"
        : ref.type !== "blob"
    )
      fail("invalid snapshot ref type");
  }
  return value as CalibrationPins;
}
function requests(value: unknown): readonly CalibrationAttemptRefs[] {
  if (!Array.isArray(value) || value.length === 0)
    fail("manifest attempts required");
  for (const request of value) {
    const item = shape(request, [
      "identity",
      "case_id",
      "trial_ref",
      "grade_ref",
    ]);
    nonempty(item["case_id"]);
    for (const [key, kind] of [
      ["trial_ref", "trial"],
      ["grade_ref", "grade"],
    ]) {
      const ref = parseContentRef(item[key!]);
      if (ref.type !== "record" || ref.kind !== kind)
        fail("invalid attempt event ref");
    }
  }
  return value as CalibrationAttemptRefs[];
}
async function replayAttempt(
  archive: EvaluationArchive,
  request: CalibrationAttemptRefs,
  pins: CalibrationPins,
  suite: GateSuiteRecord,
  publicRubric: PublicGateRubric,
) {
  const trial = await archive.getRecord(request.trial_ref);
  const completed = await archive.getRecord(request.grade_ref);
  const expectedBinding = binding(request, pins, suite);
  same(trial.identity, request.identity);
  same(completed.identity, request.identity);
  same(trial.payload, {
    type: "gate_calibration_trial",
    phase: "started",
    case_id: request.case_id,
    pins,
    binding: expectedBinding,
  });
  const data = shape(completed.payload, [
    "type",
    "scope",
    "gate_acceptance",
    "case_id",
    "pins",
    "binding",
    "trial_ref",
    "status",
    "observed",
    "artifact_refs",
    "raw_report_ref",
    "adjudication",
    "error",
  ]);
  if (data["type"] !== "gate_calibration_grade") fail("invalid grade type");
  same(data["scope"], "semantic_components");
  same(data["gate_acceptance"], {
    state: "not_assessed",
    reason: "runtime enforcement and nonsemantic components are not assessed",
  });
  same(data["pins"], pins);
  same(data["binding"], expectedBinding);
  same(data["trial_ref"], request.trial_ref);
  same(data["case_id"], request.case_id);
  observed(data["observed"]);
  if (!Array.isArray(data["artifact_refs"])) fail("invalid grade artifacts");
  data["artifact_refs"].forEach(parseContentRef);
  const grade = completed.payload as unknown as CalibrationGrade;
  let report: unknown = null;
  const selected = suite.payload.cases.find(
    (item) => item.case_id === request.case_id,
  )!;
  if (grade.raw_report_ref !== null) {
    if (
      selected.exposure === "reserved" ||
      publicRubric.criteria.some((item) => item.target.kind !== "step_output")
    )
      fail("unattemptable case has a report");
    const rawRef = parseContentRef(grade.raw_report_ref);
    if (rawRef.type !== "blob") fail("raw report requires blob ref");
    report = await readJson(archive, rawRef);
    const content = utf8(await archive.getBlob(selected.target_ref));
    const result = evaluateSemanticEvaluation(
      context(publicRubric, expectedBinding, content),
      report,
    );
    same(grade.adjudication, result);
    same(grade.status, status(result));
    same(grade.error, null);
  } else {
    if (!["error", "incomplete", "unattempted"].includes(grade.status))
      fail("missing raw report for completed grade");
    same(grade.adjudication, null);
    const error = shape(grade.error, ["code", "message"]);
    nonempty(error["code"]);
    nonempty(error["message"]);
    if (selected.exposure === "reserved") {
      same(grade.status, "unattempted");
      same(grade.error, {
        code: "reserved_case",
        message: "case was not attempted",
      });
    } else if (
      publicRubric.criteria.some((item) => item.target.kind !== "step_output")
    ) {
      same(grade.status, "unattempted");
      same(grade.error, {
        code: "unsupported_target",
        message: "case was not attempted",
      });
    } else if (grade.status === "unattempted")
      fail("ordinary step output cannot be unattempted");
  }
  await resolveClosure(archive, [
    request.grade_ref,
    ...pinRefs(pins),
    request.trial_ref,
    ...grade.artifact_refs,
    ...(grade.raw_report_ref ? [grade.raw_report_ref] : []),
  ]);
  return { ...request, grade, report };
}
/** Resolves actual immutable snapshots and re-adjudicates reports; runtime history is irrelevant. */
export async function replayGateCalibration(
  archive: EvaluationArchive,
  invocationRef: RecordRef,
): Promise<GateCalibrationReplay> {
  const invocation = await archive.getRecord(invocationRef);
  if (invocation.kind !== "evidence") fail("invocation evidence required");
  const data = shape(invocation.payload, [
    "type",
    "phase",
    "pins",
    "started_ref",
    "attempts",
  ]);
  if (
    data["type"] !== "gate_calibration_invocation" ||
    data["phase"] !== "completed"
  )
    fail("completed invocation required; starts alone are incomplete");
  const pins = parsePins(data["pins"]);
  const publicRubric = (await readJson(
    archive,
    pins.rubric_ref,
  )) as PublicGateRubric;
  const suite = parseGateSuiteRecord(
    await archive.getRecord(pins.suite_ref),
    publicRubric,
  );
  const configured = evaluator(
    (await readJson(archive, pins.evaluator_ref)) as CalibrationEvaluator,
  );
  await evaluateSnapshot(archive, pins.gate_ref, publicRubric);
  const requested = requests(data["attempts"]);
  prepare(
    suite,
    publicRubric,
    requested.map((item) => ({
      identity: item.identity,
      case_id: item.case_id,
    })),
  );
  const startedRef = parseContentRef(data["started_ref"]);
  if (startedRef.type !== "record" || startedRef.kind !== "evidence")
    fail("invalid started manifest ref");
  const started = await archive.getRecord(startedRef);
  same(started.payload, {
    type: "gate_calibration_invocation",
    phase: "started",
    pins,
    attempts: requested.map(({ grade_ref: _gradeRef, ...attempt }) => attempt),
  });
  await resolveClosure(archive, [invocationRef, ...pinRefs(pins), startedRef]);
  const attempts = [];
  for (const request of requested)
    attempts.push(
      await replayAttempt(archive, request, pins, suite, publicRubric),
    );
  return frozen({
    suite,
    public_rubric: publicRubric,
    evaluator: configured,
    pins,
    attempts,
  });
}
