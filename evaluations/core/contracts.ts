// Optional archive contracts; no runtime workflow or resource catalog authority.
import {
  canonicalJson,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";

type RecordKind =
  "task" | "suite" | "trial" | "grade" | "promotion" | "evidence";
type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };
type Digest = `sha256:${string}`;

export type ContentRef =
  | {
      readonly type: "record";
      readonly kind: RecordKind;
      readonly digest: Digest;
    }
  | {
      readonly type: "blob";
      readonly media_type: string;
      readonly digest: Digest;
    };

// Field order/names match the native local-coding-v1 records.py schema-2 identity.
type TrialIdentity = {
  readonly experiment_id: string;
  readonly task_id: string;
  readonly variant_id: string;
  readonly client: string;
  readonly arm: string;
  readonly repetition: number;
  readonly attempt_id: string;
};
type UnknownMeasurement = {
  readonly state: "unknown";
  readonly reason: string;
};
type Usage =
  | UnknownMeasurement
  | {
      readonly state: "known";
      readonly unit: string;
      readonly values: Readonly<Record<string, number>>;
      readonly source: ContentRef;
    };
type Cost =
  | UnknownMeasurement
  | {
      readonly state: "known";
      readonly currency: string;
      readonly amount: number;
      readonly source: ContentRef;
    };
type Revision = { readonly id: string; readonly version: string };
type Provenance = {
  readonly adapter: Revision;
  readonly source: Revision;
  readonly refs: readonly ContentRef[];
};
type IdentityBinding =
  | { readonly kind: "trial" | "grade"; readonly identity: TrialIdentity }
  | {
      readonly kind: Exclude<RecordKind, "trial" | "grade">;
      readonly identity?: TrialIdentity;
    };
type RecordBody = IdentityBinding & {
  readonly schema_version: 1;
  readonly provenance: Provenance;
  readonly refs: readonly ContentRef[];
  readonly usage: Usage;
  readonly cost: Cost;
  /** Domain-specific contracts specialize this JSON payload in their own package module. */
  readonly payload: JsonObject;
};

export type ArchiveRecord = RecordBody & { readonly record_id: Digest };
export type ArchiveRecordInput = IdentityBinding &
  Omit<RecordBody, "kind" | "identity" | "usage" | "cost"> & {
    readonly usage?: Usage;
    readonly cost?: Cost;
  };

const kinds = new Set<string>([
  "task",
  "suite",
  "trial",
  "grade",
  "promotion",
  "evidence",
]);
const identityFields = [
  "experiment_id",
  "task_id",
  "variant_id",
  "client",
  "arm",
  "repetition",
  "attempt_id",
];
const bodyFields = [
  "schema_version",
  "kind",
  "provenance",
  "refs",
  "usage",
  "cost",
  "payload",
];

function fail(path: string, requirement: string): never {
  throw new TypeError(`${path}: ${requirement}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, "expected a JSON object");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    fail(path, "expected a plain JSON object");
  return value as Record<string, unknown>;
}

function shape(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "required");
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key))
      fail(`${path}.${key}`, "unsupported control field");
  }
}

function text(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(path, "expected a nonempty string");
}

function digest(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    fail(path, "expected a canonical sha256 digest");
}

function finiteNonnegative(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail(path, "expected a finite nonnegative number");
}

function recordKind(value: unknown, path: string): void {
  if (typeof value !== "string" || !kinds.has(value))
    fail(path, "unsupported record kind");
}

function validateRef(value: unknown, path: string): void {
  const ref = object(value, path);
  digest(ref["digest"], `${path}.digest`);
  if (ref["type"] === "record") {
    shape(ref, ["type", "kind", "digest"], [], path);
    recordKind(ref["kind"], `${path}.kind`);
    return;
  }
  if (ref["type"] !== "blob") fail(`${path}.type`, "expected record or blob");
  shape(ref, ["type", "media_type", "digest"], [], path);
  text(ref["media_type"], `${path}.media_type`);
}

function refs(value: unknown, path: string, minimum = 0): void {
  if (!Array.isArray(value) || value.length < minimum)
    fail(path, `expected at least ${minimum} content references`);
  value.forEach((ref: unknown, index: number) =>
    validateRef(ref, `${path}[${index}]`),
  );
}

function identity(value: unknown): void {
  const binding = object(value, "identity");
  shape(binding, identityFields, [], "identity");
  for (const field of identityFields) {
    if (field !== "repetition") text(binding[field], `identity.${field}`);
  }
  const repetition = binding["repetition"];
  if (
    typeof repetition !== "number" ||
    !Number.isSafeInteger(repetition) ||
    repetition <= 0
  ) {
    fail("identity.repetition", "expected a positive safe integer");
  }
}

function revision(value: unknown, path: string): void {
  const binding = object(value, path);
  shape(binding, ["id", "version"], [], path);
  text(binding["id"], `${path}.id`);
  text(binding["version"], `${path}.version`);
}

function provenance(value: unknown): void {
  const binding = object(value, "provenance");
  shape(binding, ["adapter", "source", "refs"], [], "provenance");
  revision(binding["adapter"], "provenance.adapter");
  revision(binding["source"], "provenance.source");
  refs(binding["refs"], "provenance.refs", 1);
}

function measurement(value: unknown, path: "usage" | "cost"): void {
  const binding = object(value, path);
  if (binding["state"] === "unknown") {
    shape(binding, ["state", "reason"], [], path);
    text(binding["reason"], `${path}.reason`);
    return;
  }
  if (binding["state"] !== "known")
    fail(`${path}.state`, "expected explicit known or unknown");
  validateRef(binding["source"], `${path}.source`);
  if (path === "cost") {
    shape(binding, ["state", "currency", "amount", "source"], [], path);
    text(binding["currency"], "cost.currency");
    finiteNonnegative(binding["amount"], "cost.amount");
    return;
  }
  shape(binding, ["state", "unit", "values", "source"], [], path);
  text(binding["unit"], "usage.unit");
  const values = object(binding["values"], "usage.values");
  if (Object.keys(values).length === 0)
    fail("usage.values", "known usage requires at least one measured value");
  for (const [key, count] of Object.entries(values)) {
    text(key, "usage.values key");
    finiteNonnegative(count, `usage.values.${key}`);
  }
}

// Reject lossy JSON before canonicalJson, which intentionally omits undefined object values.
function validateJson(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") fail(path, "expected lossless JSON");
  if (ancestors.has(value)) fail(path, "cyclic JSON");
  ancestors.add(value);
  if (Array.isArray(value)) validateArray(value, path, ancestors);
  else validateObject(object(value, path), path, ancestors);
  ancestors.delete(value);
}

function validateArray(
  value: unknown[],
  path: string,
  ancestors: Set<object>,
): void {
  // Canonical hashing calls entries(); inherited overrides can rewrite the content.
  if (Object.getPrototypeOf(value) !== Array.prototype)
    fail(path, "nonstandard array prototype");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1)
    fail(path, "sparse arrays and extra array properties are not JSON");
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor))
      fail(path, "expected array data properties");
    validateJson(descriptor.value, `${path}[${index}]`, ancestors);
  }
}

function validateObject(
  value: Record<string, unknown>,
  path: string,
  ancestors: Set<object>,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(path, "symbol keys are not JSON");
    // The shared canonical encoder constructs plain objects; reserve its prototype setter.
    if (key === "__proto__") fail(`${path}.${key}`, "unsupported JSON key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(`${path}.${key}`, "expected enumerable data properties");
    }
    validateJson(descriptor.value, `${path}.${key}`, ancestors);
  }
}

function validateBody(body: Record<string, unknown>): void {
  shape(body, bodyFields, ["identity"], "record");
  if (body["schema_version"] !== 1)
    fail("schema_version", "unsupported archive schema version");
  recordKind(body["kind"], "kind");
  const requiresIdentity = body["kind"] === "trial" || body["kind"] === "grade";
  if (requiresIdentity || Object.hasOwn(body, "identity"))
    identity(body["identity"]);
  provenance(body["provenance"]);
  refs(body["refs"], "refs");
  measurement(body["usage"], "usage");
  measurement(body["cost"], "cost");
  object(body["payload"], "payload");
}

function freezeJson(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const member of Object.values(value)) freezeJson(member);
  Object.freeze(value);
}

function immutableCopy<T>(value: T): T {
  const copy: T = JSON.parse(canonicalJson(value)) as T;
  freezeJson(copy);
  return copy;
}

/** Validate refs without resolving them; the archive verifies referenced bytes separately. */
export function parseContentRef(value: unknown): ContentRef {
  validateJson(value, "ref", new Set());
  validateRef(value, "ref");
  return immutableCopy(value) as ContentRef;
}

/** Freeze a detached record; omitted measurements become explicit unknowns, never zero. */
export function createArchiveRecord(input: ArchiveRecordInput): ArchiveRecord {
  validateJson(input, "record", new Set());
  const body = {
    usage: { state: "unknown", reason: "not recorded" },
    cost: { state: "unknown", reason: "not recorded" },
    ...input,
  };
  validateBody(body);
  return immutableCopy({
    ...body,
    record_id: hashCanonical(body),
  }) as ArchiveRecord;
}

/** Parse an already frozen envelope: unknown controls, missing states and tampering fail. */
export function parseArchiveRecord(value: unknown): ArchiveRecord {
  validateJson(value, "record", new Set());
  const record = object(value, "record");
  shape(record, [...bodyFields, "record_id"], ["identity"], "record");
  const { record_id: recordId, ...body } = record;
  digest(recordId, "record_id");
  validateBody(body);
  if (recordId !== hashCanonical(body))
    fail("record_id", "digest does not match the record body");
  return immutableCopy(record) as ArchiveRecord;
}
