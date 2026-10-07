// Opt-in private suite specialization; public gate definitions remain runtime-owned.
import { SemanticCriterionSchema } from "../../server/src/engine/gates/core/gate-schema.ts";
import type {
  SemanticCriterion,
  SemanticObservationState,
} from "../../server/src/shared/types/gate-evaluation.ts";
import { hashCanonical } from "../../server/src/shared/utils/hash.ts";
import {
  createArchiveRecord,
  parseArchiveRecord,
  parseContentRef,
} from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";

type BlobRef = Extract<ContentRef, { type: "blob" }>;
export type GateCaseFamily =
  | "positive"
  | "negative"
  | "valid_alternative"
  | "boundary"
  | "insufficient_evidence";
export type GateCaseExposure = "development" | "runtime_anchor" | "reserved";
type ReviewedLabels = {
  readonly state: "reviewed";
  readonly authority: "agent" | "human";
  readonly reviewer_id: string;
  readonly evidence_refs: readonly ContentRef[];
};
type LabelReview =
  ReviewedLabels | { readonly state: "unreviewed"; readonly reason: string };
/** Supplied reviewer receipts, not proof of human identity or automatic promotion authority. */
type HumanCalibration =
  | { readonly state: "unknown"; readonly reason: string }
  | {
      readonly state: "known";
      readonly reviewer_id: string;
      readonly evidence_refs: readonly ContentRef[];
    };
export type GateSuiteCase = {
  readonly case_id: string;
  readonly target_ref: BlobRef;
  readonly family: GateCaseFamily;
  readonly exposure: GateCaseExposure;
  readonly expected_criterion_states: Readonly<
    Record<string, SemanticObservationState>
  >;
  readonly expected_acceptance: boolean;
  readonly label_review: LabelReview;
};
export type GateSuitePayload = {
  readonly suite_id: string;
  readonly revision: string;
  readonly gate_id: string;
  readonly definition_digest: ContentRef["digest"];
  readonly criterion_ids: readonly string[];
  readonly cases: readonly GateSuiteCase[];
  readonly human_calibration: HumanCalibration;
};
export type GateSuiteRecord = ArchiveRecord & {
  readonly kind: "suite";
  readonly payload: GateSuitePayload;
};
export interface PublicGateRubric {
  readonly gate_id: string;
  readonly definition_digest: ContentRef["digest"];
  readonly criteria: readonly SemanticCriterion[];
}

const families: readonly GateCaseFamily[] = [
  "positive",
  "negative",
  "valid_alternative",
  "boundary",
  "insufficient_evidence",
];
const exposures: readonly GateCaseExposure[] = [
  "development",
  "runtime_anchor",
  "reserved",
];
const states: readonly SemanticObservationState[] = [
  "met",
  "unmet",
  "insufficient_evidence",
  "not_applicable",
];

function fail(message: string): never {
  throw new TypeError(`gate suite: ${message}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("expected object");
  return value as Record<string, unknown>;
}
function shape(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const record = object(value);
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    fail(`expected exact fields ${keys.join(", ")}`);
  return record;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    fail("expected nonempty identifier/reason");
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    fail("expected nonempty list");
  return value;
}
function uniqueText(value: unknown): string[] {
  const items = list(value);
  items.forEach(text);
  const ids = items as string[];
  if (new Set(ids).size !== ids.length) fail("duplicate identifiers");
  return ids;
}
function digest(value: unknown): void {
  parseContentRef({
    type: "blob",
    media_type: "application/octet-stream",
    digest: value,
  });
}
function reviewRefs(value: unknown): ContentRef[] {
  return list(value).map(parseContentRef);
}
function review(value: unknown): LabelReview {
  const entry = object(value);
  if (entry["state"] === "unreviewed") {
    shape(entry, ["state", "reason"]);
    text(entry["reason"]);
  } else {
    shape(entry, ["state", "authority", "reviewer_id", "evidence_refs"]);
    if (
      entry["state"] !== "reviewed" ||
      !["agent", "human"].includes(String(entry["authority"]))
    )
      fail("invalid label review authority");
    text(entry["reviewer_id"]);
    reviewRefs(entry["evidence_refs"]);
  }
  return value as LabelReview;
}
function humanCalibration(
  value: unknown,
  cases: readonly GateSuiteCase[],
): void {
  const entry = object(value);
  if (entry["state"] === "unknown") {
    shape(entry, ["state", "reason"]);
    text(entry["reason"]);
    return;
  }
  shape(entry, ["state", "reviewer_id", "evidence_refs"]);
  if (entry["state"] !== "known")
    fail("human calibration must be explicit known or unknown");
  text(entry["reviewer_id"]);
  reviewRefs(entry["evidence_refs"]);
  if (
    cases.some(
      (item) =>
        item.label_review.state !== "reviewed" ||
        item.label_review.authority !== "human",
    )
  )
    fail("agent/unreviewed labels cannot establish human calibration");
}

function rubric(value: PublicGateRubric): PublicGateRubric {
  shape(value, ["gate_id", "definition_digest", "criteria"]);
  text(value.gate_id);
  digest(value.definition_digest);
  const criteria = list(value.criteria).map((item) =>
    SemanticCriterionSchema.parse(item),
  );
  uniqueText(criteria.map((item) => item.id));
  return {
    gate_id: value.gate_id,
    definition_digest: value.definition_digest,
    criteria,
  };
}
function validateCase(
  value: unknown,
  criteria: readonly SemanticCriterion[],
): GateSuiteCase {
  const item = shape(value, [
    "case_id",
    "target_ref",
    "family",
    "exposure",
    "expected_criterion_states",
    "expected_acceptance",
    "label_review",
  ]);
  text(item["case_id"]);
  const target = parseContentRef(item["target_ref"]);
  if (
    target.type !== "blob" ||
    target.media_type !== "text/plain;charset=utf-8"
  )
    fail("target requires a UTF-8 text blob reference");
  if (
    !families.includes(item["family"] as GateCaseFamily) ||
    !exposures.includes(item["exposure"] as GateCaseExposure)
  )
    fail("invalid case family/exposure");
  const expected = shape(
    item["expected_criterion_states"],
    criteria.map((criterion) => criterion.id),
  );
  for (const criterion of criteria) {
    const state = expected[criterion.id];
    if (!states.includes(state as SemanticObservationState))
      fail("invalid expected criterion state");
    if (state === "not_applicable" && !criterion.allow_not_applicable)
      fail("expected N/A denied by public rubric");
  }
  const accepted = Object.values(expected).every(
    (state) => state === "met" || state === "not_applicable",
  );
  if (item["expected_acceptance"] !== accepted)
    fail("expected acceptance disagrees with complete criterion states");
  if (
    ["positive", "valid_alternative"].includes(String(item["family"])) &&
    !accepted
  )
    fail("positive/valid-alternative labels must accept");
  if (
    item["family"] === "negative" &&
    (accepted || !Object.values(expected).includes("unmet"))
  )
    fail("negative labels require an unmet criterion");
  if (
    item["family"] === "insufficient_evidence" &&
    !Object.values(expected).includes("insufficient_evidence")
  )
    fail("insufficient-evidence family requires missing evidence");
  review(item["label_review"]);
  return value as GateSuiteCase;
}
function dependencies(payload: GateSuitePayload): ContentRef[] {
  const refs = payload.cases.flatMap((item) => [
    item.target_ref,
    ...(item.label_review.state === "reviewed"
      ? item.label_review.evidence_refs
      : []),
  ]);
  if (payload.human_calibration.state === "known")
    refs.push(...payload.human_calibration.evidence_refs);
  return [...new Map(refs.map((ref) => [hashCanonical(ref), ref])).values()];
}

/** Exact record_id is revision authority; suite_id/revision are descriptive aliases only. */
export function parseGateSuiteRecord(
  value: unknown,
  publicRubric: PublicGateRubric,
): GateSuiteRecord {
  const record = parseArchiveRecord(value);
  if (record.kind !== "suite" || record.identity !== undefined)
    fail("expected identity-free suite envelope");
  const authority = rubric(publicRubric);
  const payload = shape(record.payload, [
    "suite_id",
    "revision",
    "gate_id",
    "definition_digest",
    "criterion_ids",
    "cases",
    "human_calibration",
  ]);
  text(payload["suite_id"]);
  text(payload["revision"]);
  digest(payload["definition_digest"]);
  if (
    payload["gate_id"] !== authority.gate_id ||
    payload["definition_digest"] !== authority.definition_digest
  )
    fail("public gate binding mismatch");
  const ids = uniqueText(payload["criterion_ids"]);
  if (
    hashCanonical(ids) !==
    hashCanonical(authority.criteria.map((item) => item.id))
  )
    fail("exact public criterion IDs required");
  const cases = list(payload["cases"]).map((item) =>
    validateCase(item, authority.criteria),
  );
  uniqueText(cases.map((item) => item.case_id));
  humanCalibration(payload["human_calibration"], cases);
  const suite = record as GateSuiteRecord;
  const declared = new Set(record.refs.map(hashCanonical));
  if (
    dependencies(suite.payload).some((ref) => !declared.has(hashCanonical(ref)))
  )
    fail("private target/review reference missing from envelope refs");
  return suite;
}

/** Content refs are lifted into the canonical archive's dependency closure; no second store. */
export function createGateSuiteRecord(
  payload: GateSuitePayload,
  provenance: ArchiveRecord["provenance"],
  publicRubric: PublicGateRubric,
): GateSuiteRecord {
  // The generic factory validates lossless JSON before any specialization reads nested fields.
  const detached = createArchiveRecord({
    schema_version: 1,
    kind: "suite",
    provenance,
    refs: [],
    payload,
  });
  const checkedPayload = detached.payload as GateSuitePayload;
  // Parse once with declared refs, which the archive later resolves against actual bytes.
  return parseGateSuiteRecord(
    createArchiveRecord({
      schema_version: 1,
      kind: "suite",
      provenance,
      refs: dependencies(checkedPayload),
      payload: checkedPayload,
    }),
    publicRubric,
  );
}

/** Structural pilot eligibility only, never a statistical or human-calibrated promotion claim. */
export function gateSuiteReadiness(
  value: unknown,
  publicRubric: PublicGateRubric,
): {
  readonly ready: boolean;
  readonly reasons: readonly string[];
  readonly human_calibration: HumanCalibration;
} {
  const suite = parseGateSuiteRecord(value, publicRubric);
  const reasons: string[] = [];
  for (const family of families) {
    if (
      !suite.payload.cases.some(
        (item) =>
          item.family === family &&
          item.exposure !== "reserved" &&
          item.label_review.state === "reviewed",
      )
    )
      reasons.push(`missing reviewed family: ${family}`);
  }
  if (
    suite.payload.cases.some((item) => item.label_review.state !== "reviewed")
  )
    reasons.push("unreviewed expected labels");
  if (!suite.payload.cases.some((item) => item.exposure === "reserved"))
    reasons.push("missing reserved slice");
  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
    human_calibration: suite.payload.human_calibration,
  });
}

/** Explicit allowlist projection. Caller selects one private case; siblings/answers stay private. */
export function projectGateSuiteCase(
  value: unknown,
  caseId: string,
  publicRubric: PublicGateRubric,
): {
  readonly target_ref: BlobRef;
  readonly public_rubric: PublicGateRubric;
  readonly criterion_ids: readonly string[];
} {
  const suite = parseGateSuiteRecord(value, publicRubric);
  const selected = suite.payload.cases.find((item) => item.case_id === caseId);
  if (selected === undefined) fail("unknown selected case");
  if (selected.exposure === "reserved")
    fail("reserved cases cannot enter ordinary adapter context");
  return {
    target_ref: selected.target_ref,
    public_rubric: rubric(publicRubric),
    criterion_ids: suite.payload.criterion_ids,
  };
}
