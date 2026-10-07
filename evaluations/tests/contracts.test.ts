import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import {
  createArchiveRecord,
  parseArchiveRecord,
  parseContentRef,
} from "../core/contracts.ts";
import type {
  ArchiveRecord,
  ArchiveRecordInput,
  ContentRef,
} from "../core/contracts.ts";

const source: ContentRef = {
  type: "blob",
  media_type: "application/json",
  digest: hashBytes("{}") as ContentRef["digest"],
};
const identity = {
  experiment_id: "experiment",
  task_id: "task",
  variant_id: "variant",
  client: "codex",
  arm: "current",
  repetition: 1,
  attempt_id: "attempt-1",
};

function input(): ArchiveRecordInput {
  return {
    schema_version: 1,
    kind: "trial",
    identity,
    provenance: {
      adapter: { id: "native-codex", version: "1" },
      source: { id: "native-schema", version: "2" },
      refs: [source],
    },
    refs: [source],
    payload: { terminal: "incomplete", raw_usage: null },
  };
}

function mutableRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createArchiveRecord(input()))) as Record<
    string,
    unknown
  >;
}

function rehash(record: Record<string, unknown>): Record<string, unknown> {
  const { record_id: _recordId, ...body } = record;
  return { ...body, record_id: hashCanonical(body) };
}

test("native JSON round trips retain all six domain-neutral record kinds", () => {
  for (const kind of [
    "task",
    "suite",
    "trial",
    "grade",
    "promotion",
    "evidence",
  ] as const) {
    const record = createArchiveRecord({ ...input(), kind, identity });
    assert.equal(record.kind, kind);
    assert.deepEqual(
      parseArchiveRecord(JSON.parse(JSON.stringify(record))),
      record,
    );
    assert.deepEqual(record.identity, identity);
    const ref = parseContentRef({
      type: "record",
      kind,
      digest: record.record_id,
    });
    assert.deepEqual(ref, { type: "record", kind, digest: record.record_id });
    assert.ok(Object.isFrozen(ref));
    if (kind !== "trial" && kind !== "grade") {
      const { identity: _identity, kind: _kind, ...fields } = input();
      assert.equal(
        createArchiveRecord({ ...fields, kind }).identity,
        undefined,
      );
    }
  }
});

test("factory detaches and recursively freezes record data and refs", () => {
  const payload = { results: [{ accepted: false }] };
  const record = createArchiveRecord({ ...input(), payload });
  payload.results[0]!.accepted = true;
  assert.deepEqual(record.payload, { results: [{ accepted: false }] });
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.payload["results"]));
  assert.ok(Object.isFrozen(record.refs[0]));
  assert.equal(
    Reflect.set(record.payload["results"] as object, "0", {}),
    false,
  );
});

test("unmeasured and partial billing remain explicitly unknown; known zero is retained", () => {
  const unknown = createArchiveRecord(input());
  assert.deepEqual(unknown.usage, { state: "unknown", reason: "not recorded" });
  assert.deepEqual(unknown.cost, { state: "unknown", reason: "not recorded" });
  const partial = createArchiveRecord({
    ...input(),
    cost: { state: "unknown", reason: "child billing unavailable" },
  });
  assert.equal(partial.cost.state, "unknown");
  const zero = createArchiveRecord({
    ...input(),
    usage: {
      state: "known",
      unit: "tokens",
      values: { input: 0, output: 0 },
      source,
    },
    cost: { state: "known", amount: 0, currency: "USD", source },
  });
  const replay: ArchiveRecord = parseArchiveRecord(
    JSON.parse(JSON.stringify(zero)),
  );
  assert.deepEqual(replay.usage, zero.usage);
  assert.deepEqual(replay.cost, zero.cost);
  for (const field of ["usage", "cost"]) {
    const record = mutableRecord();
    delete record[field];
    assert.throws(() => parseArchiveRecord(rehash(record)), /required/);
    record[field] = { state: "unknown", reason: "missing", amount: 0 };
    assert.throws(
      () => parseArchiveRecord(rehash(record)),
      /unsupported control field/,
    );
  }
});

test("canonical record digest binds every body field and is independent of object key order", () => {
  const record = createArchiveRecord(input());
  const { record_id: recordId, ...body } = record;
  assert.equal(recordId, hashCanonical(body));
  assert.equal(
    createArchiveRecord({ ...input(), payload: { b: 2, a: 1 } }).record_id,
    createArchiveRecord({ ...input(), payload: { a: 1, b: 2 } }).record_id,
  );
  const altered = mutableRecord();
  altered["payload"] = { terminal: "completed" };
  assert.throws(() => parseArchiveRecord(altered), /digest does not match/);
});

test("each native identity field binds a distinct record; retry attempts remain separate", () => {
  const baseline = createArchiveRecord(input());
  const digests = new Set([baseline.record_id]);
  for (const [field, value] of Object.entries(identity)) {
    const changed = {
      ...identity,
      [field]: typeof value === "number" ? value + 1 : `${value}-next`,
    };
    const record = createArchiveRecord({ ...input(), identity: changed });
    assert.notEqual(record.record_id, baseline.record_id, field);
    assert.deepEqual(record.identity, changed);
    digests.add(record.record_id);
  }
  assert.equal(digests.size, 8);
  assert.equal(baseline.identity?.attempt_id, "attempt-1");
});

test("trial and grade require complete native identity; malformed bindings fail even when rehashed", () => {
  for (const kind of ["trial", "grade"]) {
    const record = mutableRecord();
    record["kind"] = kind;
    delete record["identity"];
    assert.throws(() => parseArchiveRecord(rehash(record)), /identity/);
  }
  for (const repetition of [
    0,
    -1,
    1.5,
    true,
    "1",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const record = mutableRecord();
    record["identity"] = { ...identity, repetition };
    assert.throws(
      () => parseArchiveRecord(rehash(record)),
      /positive safe integer/,
    );
  }
  for (const field of [
    "experiment_id",
    "task_id",
    "variant_id",
    "client",
    "arm",
    "attempt_id",
  ]) {
    const record = mutableRecord();
    record["identity"] = { ...identity, [field]: " " };
    assert.throws(() => parseArchiveRecord(rehash(record)), /nonempty string/);
  }
  const record = mutableRecord();
  record["identity"] = { ...identity, task: "alias" };
  assert.throws(
    () => parseArchiveRecord(rehash(record)),
    /unsupported control field/,
  );
});

test("references reject malformed digests, mixed shapes and unsupported kinds", () => {
  for (const digest of [
    "",
    "0".repeat(64),
    "sha256:" + "A".repeat(64),
    "sha256:123",
  ]) {
    assert.throws(
      () => parseContentRef({ ...source, digest }),
      /canonical sha256/,
    );
  }
  for (const ref of [
    { ...source, kind: "trial" },
    { type: "record", kind: "other", digest: source.digest },
    { ...source, type: "file" },
    { ...source, media_type: "" },
  ]) {
    assert.throws(() => parseContentRef(ref), TypeError);
  }
  const record = mutableRecord();
  record["refs"] = [{ ...source, digest: "bad" }];
  assert.throws(() => parseArchiveRecord(rehash(record)), /refs\[0\].digest/);
});

test("finite nonnegative numeric bounds and measurement source metadata are enforced", () => {
  for (const amount of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(
      () =>
        createArchiveRecord({
          ...input(),
          cost: { state: "known", amount, currency: "USD", source },
        }),
      TypeError,
    );
    assert.throws(
      () =>
        createArchiveRecord({
          ...input(),
          usage: {
            state: "known",
            unit: "tokens",
            values: { input: amount },
            source,
          },
        }),
      TypeError,
    );
  }
  for (const cost of [
    { state: "known", amount: 0, source },
    { state: "known", amount: 0, currency: "", source },
    { state: "known", amount: 0, currency: "USD" },
    { state: "unknown", reason: "" },
    { state: "partial", amount: 0 },
  ]) {
    const record = mutableRecord();
    record["cost"] = cost;
    assert.throws(() => parseArchiveRecord(rehash(record)), TypeError);
  }
  for (const usage of [
    { state: "known", unit: "tokens", values: {}, source },
    { state: "known", unit: "", values: { input: 0 }, source },
    { state: "known", unit: "tokens", values: { input: 0 } },
    { state: "unknown", reason: " " },
  ]) {
    const record = mutableRecord();
    record["usage"] = usage;
    assert.throws(() => parseArchiveRecord(rehash(record)), TypeError);
  }
});

test("version, adapter/source provenance and control shapes are mandatory", () => {
  for (const patch of [
    { schema_version: 2 },
    { kind: "experiment" },
    { extra: true },
    {
      provenance: {
        adapter: { id: "adapter", version: "" },
        source: { id: "source", version: "2" },
        refs: [source],
      },
    },
    {
      provenance: {
        adapter: { id: "adapter", version: "1" },
        source: { id: "source" },
        refs: [source],
      },
    },
    {
      provenance: {
        adapter: { id: "adapter", version: "1" },
        source: { id: "source", version: "2" },
        refs: [],
      },
    },
  ]) {
    assert.throws(
      () => parseArchiveRecord(rehash({ ...mutableRecord(), ...patch })),
      TypeError,
    );
  }
});

test("lossy payloads, cycles and executable object properties cannot enter the archive", () => {
  const cycle: Record<string, unknown> = {};
  cycle["self"] = cycle;
  let accessorCalls = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "hidden";
    },
  });
  for (const payload of [
    { value: undefined },
    { value: Infinity },
    { value: 1n },
    { value: new Date() },
    { value: () => 1 },
    { value: Symbol() },
    { value: Array(2) },
    cycle,
    accessor,
    JSON.parse('{"__proto__":1}') as unknown,
  ]) {
    assert.throws(
      () => createArchiveRecord({ ...input(), payload } as ArchiveRecordInput),
      TypeError,
    );
  }
  assert.equal(accessorCalls, 0);
});
