// Reviewed evidence receipts only. Existing MCP resource authority owns every actual mutation.
import {
  canonicalJson,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import {
  createArchiveRecord,
  parseArchiveRecord,
  parseContentRef,
} from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";
import type { EvaluationArchive } from "../core/archive.ts";
import { replayGateCalibration } from "./calibration.ts";
import type {
  CalibrationAttempt,
  GateCalibrationReplay,
} from "./calibration.ts";
import {
  compareGateCalibrationReports,
  projectGateCalibration,
} from "./report.ts";
import type { GateCalibrationReport } from "./report.ts";

type RecordRef = Extract<ContentRef, { type: "record" }>;
type BlobRef = Extract<ContentRef, { type: "blob" }>;
export type GatePromotionDisposition = "accepted" | "rejected" | "inconclusive";
export interface GatePromotionResourceReference {
  readonly gate_id: string;
  readonly ref: ContentRef;
}
export interface GatePromotionReview {
  readonly disposition: GatePromotionDisposition;
  readonly authority: "caller_declared";
  readonly reviewer: { readonly kind: "human" | "agent"; readonly id: string };
  readonly evidence_refs: readonly ContentRef[];
  readonly rationale: string;
}
export interface GatePromotionCurrentBinding extends Pick<
  GateCalibrationReport,
  "pins" | "selected_target_coverage"
> {
  readonly policy_ref: ContentRef;
  readonly destination: GatePromotionResourceReference;
  readonly rollback: GatePromotionResourceReference;
}
export interface GatePromotionRequest {
  readonly archive: EvaluationArchive;
  readonly invocation_ref: RecordRef;
  readonly report_ref: BlobRef;
  readonly policy_ref: ContentRef;
  readonly destination: GatePromotionResourceReference;
  readonly rollback: GatePromotionResourceReference;
  readonly review: GatePromotionReview;
  readonly requested?: readonly CalibrationAttempt[];
}
interface PromotionEvidence {
  readonly invocation_ref: RecordRef;
  readonly report_ref: BlobRef;
  readonly policy_ref: ContentRef;
  readonly destination: GatePromotionResourceReference;
  readonly rollback: GatePromotionResourceReference;
  readonly review: GatePromotionReview;
  readonly requested_inventory: readonly CalibrationAttempt[] | null;
}
export interface GatePromotionPayload extends PromotionEvidence {
  readonly type: "gate_promotion_receipt";
  readonly scope: "semantic_components";
  readonly binding: Pick<
    GateCalibrationReport,
    "pins" | "selected_target_coverage"
  >;
  readonly requested_disposition: GatePromotionDisposition;
  readonly effective_disposition: GatePromotionDisposition;
  readonly disposition_reason: string;
  readonly human_calibration: {
    readonly state: "known" | "unknown";
    readonly authority: "caller_declared";
  };
  readonly automatic_promotion: false;
}
export type GatePromotionReceipt = ArchiveRecord & {
  readonly kind: "promotion";
  readonly payload: GatePromotionPayload;
};
export interface GatePromotionReplay {
  readonly receipt: GatePromotionReceipt;
  readonly report: GateCalibrationReport;
  readonly applicability: "matching" | "stale";
  readonly changed_bindings: readonly string[];
  readonly eligibility:
    "reviewed_candidate" | "rejected" | "inconclusive" | "stale";
  readonly authority: "caller_declared";
  readonly automatic_promotion: false;
}
function fail(message: string): never {
  throw new TypeError(`gate promotion receipt: ${message}`);
}
function shape(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected object");
  const object = value as Record<string, unknown>;
  if (
    keys.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(object).some((key) => !keys.includes(key))
  )
    fail("missing or unsupported fields");
  return object;
}
function text(value: unknown): void {
  if (typeof value !== "string" || !value.trim())
    fail("nonempty text required");
}
function same(actual: unknown, expected: unknown, message: string): void {
  if (hashCanonical(actual) !== hashCanonical(expected)) fail(message);
}
function resource(value: unknown): void {
  const data = shape(value, ["gate_id", "ref"]);
  text(data["gate_id"]);
  parseContentRef(data["ref"]);
}
function review(value: unknown): void {
  const data = shape(value, [
    "disposition",
    "authority",
    "reviewer",
    "evidence_refs",
    "rationale",
  ]);
  if (
    typeof data["disposition"] !== "string" ||
    !["accepted", "rejected", "inconclusive"].includes(data["disposition"])
  )
    fail("invalid reviewed disposition");
  same(
    data["authority"],
    "caller_declared",
    "review authority must remain caller_declared",
  );
  const reviewer = shape(data["reviewer"], ["kind", "id"]);
  if (reviewer["kind"] !== "human" && reviewer["kind"] !== "agent")
    fail("invalid reviewer kind");
  text(reviewer["id"]);
  text(data["rationale"]);
  const refs = data["evidence_refs"];
  if (!Array.isArray(refs) || refs.length === 0)
    fail("review evidence required");
  refs.forEach(parseContentRef);
}
function validateEvidence(value: PromotionEvidence): void {
  const invocation = parseContentRef(value.invocation_ref);
  if (invocation.type !== "record" || invocation.kind !== "evidence")
    fail("calibration invocation evidence required");
  const report = parseContentRef(value.report_ref);
  if (report.type !== "blob" || report.media_type !== "application/json")
    fail("canonical report JSON blob required");
  parseContentRef(value.policy_ref);
  resource(value.destination);
  resource(value.rollback);
  review(value.review);
  if (
    value.requested_inventory !== null &&
    !Array.isArray(value.requested_inventory)
  )
    fail("requested inventory requires an array or null");
}
function evidenceRefs(value: PromotionEvidence): ContentRef[] {
  return [
    value.invocation_ref,
    value.report_ref,
    value.policy_ref,
    value.destination.ref,
    value.rollback.ref,
    ...value.review.evidence_refs,
  ];
}
function envelope(
  payload: unknown,
  refs: readonly ContentRef[],
): ArchiveRecord {
  return createArchiveRecord({
    schema_version: 1,
    kind: "promotion",
    provenance: {
      adapter: { id: "gate-promotion-receipt", version: "1" },
      source: { id: "verified-gate-replay-projection", version: "1" },
      refs,
    },
    refs,
    payload: payload as ArchiveRecord["payload"],
  });
}
function capture(input: GatePromotionRequest): PromotionEvidence {
  const { archive: _archive, requested: _requested, ...required } = input;
  shape(required, [
    "invocation_ref",
    "report_ref",
    "policy_ref",
    "destination",
    "rollback",
    "review",
  ]);
  if (input.requested !== undefined && !Array.isArray(input.requested))
    fail("requested inventory requires an array");
  const record = envelope(
    {
      ...required,
      requested_inventory:
        input.requested === undefined ? null : input.requested,
    },
    [input.invocation_ref],
  );
  const captured = record.payload as unknown as PromotionEvidence;
  validateEvidence(captured);
  return captured;
}
async function verifiedReport(
  archive: EvaluationArchive,
  evidence: PromotionEvidence,
) {
  await archive.resolveClosure(evidenceRefs(evidence));
  const replay = await replayGateCalibration(archive, evidence.invocation_ref);
  const report = projectGateCalibration(
    replay,
    evidence.requested_inventory === null
      ? {}
      : { requested: evidence.requested_inventory },
  );
  const bytes = await archive.getBlob(evidence.report_ref);
  if (!bytes.equals(Buffer.from(canonicalJson(report), "utf8")))
    fail("report bytes differ from verified replay projection");
  same(
    evidence.destination.gate_id,
    replay.suite.payload.gate_id,
    "destination gate binding mismatch",
  );
  same(
    evidence.rollback.gate_id,
    replay.suite.payload.gate_id,
    "rollback gate binding mismatch",
  );
  return { replay, report };
}
function derivedDisposition(
  evidence: PromotionEvidence,
  replay: GateCalibrationReplay,
) {
  const requested = evidence.review.disposition;
  const human = replay.suite.payload.human_calibration.state;
  const restricted =
    requested === "accepted" &&
    (human !== "known" || evidence.review.reviewer.kind !== "human");
  return {
    requested_disposition: requested,
    effective_disposition: restricted ? ("inconclusive" as const) : requested,
    disposition_reason: restricted
      ? "accepted review cannot establish eligibility with agent-only review or unknown human calibration"
      : "recorded reviewed disposition under supplied frozen policy evidence",
    human_calibration: { state: human, authority: "caller_declared" as const },
  };
}
function payload(
  evidence: PromotionEvidence,
  replay: GateCalibrationReplay,
  report: GateCalibrationReport,
): GatePromotionPayload {
  return {
    ...evidence,
    type: "gate_promotion_receipt",
    scope: "semantic_components",
    binding: {
      pins: report.pins,
      selected_target_coverage: report.selected_target_coverage,
    },
    ...derivedDisposition(evidence, replay),
    automatic_promotion: false,
  };
}
/** Creates a detached receipt; caller explicitly publishes it with archive.putRecord. */
export async function createGatePromotionReceipt(
  input: GatePromotionRequest,
): Promise<GatePromotionReceipt> {
  const evidence = capture(input); // Detach caller-owned data before any await.
  const { replay, report } = await verifiedReport(input.archive, evidence);
  return envelope(
    payload(evidence, replay, report),
    evidenceRefs(evidence),
  ) as GatePromotionReceipt;
}
function parseReceipt(record: ArchiveRecord): GatePromotionReceipt {
  const parsed = parseArchiveRecord(record);
  if (parsed.kind !== "promotion" || parsed.identity !== undefined)
    fail("identity-free promotion record required");
  shape(parsed.payload, [
    "invocation_ref",
    "report_ref",
    "policy_ref",
    "destination",
    "rollback",
    "review",
    "requested_inventory",
    "type",
    "scope",
    "binding",
    "requested_disposition",
    "effective_disposition",
    "disposition_reason",
    "human_calibration",
    "automatic_promotion",
  ]);
  const receipt = parsed as GatePromotionReceipt;
  validateEvidence(receipt.payload);
  const declared = new Set(parsed.refs.map(hashCanonical));
  if (
    evidenceRefs(receipt.payload).some(
      (ref) => !declared.has(hashCanonical(ref)),
    )
  )
    fail("receipt evidence missing from dependency refs");
  return receipt;
}
function currentBinding(
  value: GatePromotionCurrentBinding,
  evidenceRef: RecordRef,
): GatePromotionCurrentBinding {
  const captured = envelope(value, [evidenceRef])
    .payload as unknown as GatePromotionCurrentBinding;
  shape(captured, [
    "pins",
    "selected_target_coverage",
    "policy_ref",
    "destination",
    "rollback",
  ]);
  const pins = shape(captured.pins, [
    "suite_ref",
    "gate_ref",
    "rubric_ref",
    "evaluator_ref",
  ]);
  for (const key of ["suite_ref", "gate_ref", "rubric_ref", "evaluator_ref"]) {
    const ref = parseContentRef(pins[key]);
    if (
      key === "suite_ref"
        ? ref.type !== "record" || ref.kind !== "suite"
        : ref.type !== "blob"
    )
      fail("invalid current pin kind");
  }
  if (!Array.isArray(captured.selected_target_coverage))
    fail("current target coverage required");
  const seen = new Set<string>();
  for (const item of captured.selected_target_coverage) {
    shape(item, ["case_id", "target_digest"]);
    text(item.case_id);
    parseContentRef({
      type: "blob",
      digest: item.target_digest,
      media_type: "text/plain;charset=utf-8",
    });
    if (seen.has(item.case_id)) fail("duplicate current case");
    seen.add(item.case_id);
  }
  parseContentRef(captured.policy_ref);
  resource(captured.destination);
  resource(captured.rollback);
  return captured;
}
function assessment(
  receipt: GatePromotionReceipt,
  report: GateCalibrationReport,
  current: GatePromotionCurrentBinding,
): GatePromotionReplay {
  // The canonical report comparator owns exact pin and selected-target comparability.
  const compared = compareGateCalibrationReports(report, {
    ...report,
    pins: current.pins,
    selected_target_coverage: current.selected_target_coverage,
  });
  const changed = [...compared.changed_bindings];
  for (const key of ["policy_ref", "destination", "rollback"] as const) {
    if (hashCanonical(receipt.payload[key]) !== hashCanonical(current[key]))
      changed.push(key);
  }
  const matching = changed.length === 0;
  const disposition = receipt.payload.effective_disposition;
  return {
    receipt,
    report,
    applicability: matching ? "matching" : "stale",
    changed_bindings: changed,
    eligibility: !matching
      ? "stale"
      : disposition === "accepted"
        ? "reviewed_candidate"
        : disposition,
    authority: "caller_declared",
    automatic_promotion: false,
  };
}
/** Replays receipt custody and decisions; current authorities are required, never inherited. */
export async function replayGatePromotionReceipt(
  archive: EvaluationArchive,
  receiptRef: RecordRef,
  current: GatePromotionCurrentBinding,
): Promise<GatePromotionReplay> {
  const currentSnapshot = currentBinding(current, receiptRef);
  await archive.resolveClosure([receiptRef]);
  const receipt = parseReceipt(await archive.getRecord(receiptRef));
  const data = receipt.payload;
  const evidence: PromotionEvidence = {
    invocation_ref: data.invocation_ref,
    report_ref: data.report_ref,
    policy_ref: data.policy_ref,
    destination: data.destination,
    rollback: data.rollback,
    review: data.review,
    requested_inventory: data.requested_inventory,
  };
  const { replay, report } = await verifiedReport(archive, evidence);
  same(
    data,
    payload(evidence, replay, report),
    "receipt binding or derived disposition mismatch",
  );
  return assessment(receipt, report, currentSnapshot);
}
