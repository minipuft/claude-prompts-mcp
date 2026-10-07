import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { createArchiveRecord } from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";
import { createGateSuiteRecord } from "./contracts.ts";
import type { GateSuiteCase, PublicGateRubric } from "./contracts.ts";
import { replayGateCalibration, runGateCalibration } from "./calibration.ts";
import type {
  CalibrationAdapterInput,
  CalibrationAttempt,
} from "./calibration.ts";
import { projectGateCalibration } from "./report.ts";
import {
  createGatePromotionReceipt,
  replayGatePromotionReceipt,
} from "./promotion.ts";
import type {
  GatePromotionCurrentBinding,
  GatePromotionRequest,
  GatePromotionReview,
} from "./promotion.ts";

// Acceptance inventory: real custody/roundtrip; explicit review; human limits; current
// pin/coverage/authority staleness; recomputed report binding; graph closure (all ref
// locations); tampering/unavailable archive; captured caller data. Software only.
type RecordRef = Extract<ContentRef, { type: "record" }>;
function requested(index: number): CalibrationAttempt {
  return {
    case_id: "positive",
    identity: {
      experiment_id: "software-receipt",
      task_id: `task-${index}`,
      variant_id: "control",
      client: "software-client",
      arm: "current",
      repetition: 1,
      attempt_id: `attempt-${index}`,
    },
  };
}
function softwareReport(input: CalibrationAdapterInput) {
  return {
    binding: input.binding,
    observations: input.public_rubric.criteria.map((criterion) => ({
      criterion_id: criterion.id,
      state: "met",
      value: true,
      evidence: [
        {
          target_digest: input.binding.target_digest,
          start: 0,
          end: 1,
          quote: input.target.content.slice(0, 1),
        },
      ],
      rationale: "Software-only response",
    })),
  };
}
function evidence(
  payload: ArchiveRecord["payload"],
  refs: readonly ContentRef[],
): ArchiveRecord {
  return createArchiveRecord({
    schema_version: 1,
    kind: "evidence",
    provenance: {
      adapter: { id: "software-receipt-control", version: "1" },
      source: { id: "supplied-software-metadata", version: "1" },
      refs,
    },
    refs,
    payload,
  });
}
async function fixture(human = false) {
  const root = await mkdtemp(join(tmpdir(), "promotion-receipt-control-"));
  const archive = await EvaluationArchive.open(root);
  const supplied = await archive.putBlob(
    Buffer.from(
      "synthetic supplied review receipt, not proof of human identity",
    ),
    "text/plain",
  );
  const criteria: PublicGateRubric["criteria"] = [
    {
      type: "semantic_evaluation",
      id: "action",
      question: "Synthetic question",
      target: { kind: "step_output" },
      evidence_requirements: { min_items: 1 },
      result: { kind: "boolean" },
      acceptance: { kind: "equals", value: true },
      allow_not_applicable: false,
    },
  ];
  const gate = {
    id: "receipt-control",
    name: "Software gate",
    type: "validation",
    description: "Software",
    guidance: "Software public guidance",
    pass_criteria: criteria,
    evaluation: { mode: "self", strict: true },
  };
  const gateRef = await archive.putBlob(
    Buffer.from(canonicalJson(gate)),
    "application/json",
  );
  const rubric: PublicGateRubric = {
    gate_id: gate.id,
    definition_digest: gateRef.digest,
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
        Buffer.from(`software ${family}`),
        "text/plain;charset=utf-8",
      ),
      expected_criterion_states: { action: state },
      expected_acceptance: state === "met",
      label_review: {
        state: "reviewed",
        authority: human ? "human" : "agent",
        reviewer_id: "supplied-reviewer",
        evidence_refs: [supplied],
      },
    });
  }
  cases.push({ ...cases[0]!, case_id: "reserved", exposure: "reserved" });
  const suite = createGateSuiteRecord(
    {
      suite_id: "software-receipt-suite",
      revision: "1",
      gate_id: gate.id,
      definition_digest: gateRef.digest,
      criterion_ids: ["action"],
      cases,
      human_calibration: human
        ? {
            state: "known",
            reviewer_id: "supplied-human",
            evidence_refs: [supplied],
          }
        : { state: "unknown", reason: "Only software/agent labels supplied" },
    },
    {
      adapter: { id: "software-suite", version: "1" },
      source: { id: "software-suite", version: "1" },
      refs: [supplied],
    },
    rubric,
  );
  const invocation = await runGateCalibration({
    archive,
    suite,
    public_rubric: rubric,
    gate_snapshot: gateRef,
    evaluator: {
      id: "software-callback",
      revision: "1",
      configuration: { requested_only: true },
    },
    attempts: [requested(0)],
    adapter: async (input) => ({
      state: "completed",
      report: softwareReport(input),
    }),
  });
  const verified = await replayGateCalibration(
    archive,
    invocation.invocation_ref,
  );
  const report = projectGateCalibration(verified);
  const report_ref = await archive.putBlob(
    Buffer.from(canonicalJson(report)),
    "application/json",
  );
  const policy_ref = await archive.putRecord(
    evidence(
      {
        policy:
          "Synthetic predeclared policy receipt; no default numerical thresholds",
      },
      [supplied],
    ),
  );
  const destination = {
    gate_id: gate.id,
    ref: await archive.putBlob(
      Buffer.from("operator-declared isolated destination descriptor"),
      "text/plain",
    ),
  };
  const rollback = {
    gate_id: gate.id,
    ref: await archive.putBlob(
      Buffer.from("operator-declared prior revision rollback receipt"),
      "text/plain",
    ),
  };
  const review: GatePromotionReview = {
    disposition: "accepted",
    authority: "caller_declared",
    reviewer: { kind: "human", id: "supplied-reviewer" },
    evidence_refs: [supplied],
    rationale: "Synthetic reviewed policy evidence",
  };
  const input: GatePromotionRequest = {
    archive,
    invocation_ref: invocation.invocation_ref,
    report_ref,
    policy_ref,
    destination,
    rollback,
    review,
  };
  const current: GatePromotionCurrentBinding = {
    pins: report.pins,
    selected_target_coverage: report.selected_target_coverage,
    policy_ref,
    destination,
    rollback,
  };
  return { root, archive, input, current, verified, report, supplied };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(body: (f: Fixture) => Promise<void>, human = false) {
  const f = await fixture(human);
  try {
    await body(f);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}
async function publish(
  f: Fixture,
  overrides: Partial<GatePromotionRequest> = {},
) {
  const receipt = await createGatePromotionReceipt({
    ...f.input,
    ...overrides,
  });
  return { receipt, ref: await f.archive.putRecord(receipt) };
}
function file(root: string, ref: ContentRef): string {
  return join(
    root,
    ref.type === "blob" ? "blobs" : "records",
    ref.digest.slice("sha256:".length) + (ref.type === "record" ? ".json" : ""),
  );
}
function altered(
  record: ArchiveRecord,
  payload: ArchiveRecord["payload"],
): ArchiveRecord {
  const { record_id: _id, ...body } = record;
  return createArchiveRecord({ ...body, payload });
}

test("reviewed exact-revision receipt replays with supplied human evidence and cannot authorize mutation", async () => {
  await withFixture(async (f) => {
    const { receipt, ref } = await publish(f);
    const result = await replayGatePromotionReceipt(f.archive, ref, f.current);
    assert.equal(receipt.kind, "promotion");
    assert.equal(receipt.payload.scope, "semantic_components");
    assert.deepEqual(result.receipt, receipt);
    assert.equal(result.applicability, "matching");
    assert.deepEqual(result.changed_bindings, []);
    assert.equal(result.eligibility, "reviewed_candidate");
    assert.equal(result.authority, "caller_declared");
    assert.equal(result.automatic_promotion, false);
    assert.equal(receipt.payload.automatic_promotion, false);
    assert.deepEqual(receipt.payload.human_calibration, {
      state: "known",
      authority: "caller_declared",
    });
    assert.equal(result.report.full_gate_acceptance.state, "not_assessed");
    assert.equal(receipt.usage.state, "unknown");
    assert.equal(receipt.cost.state, "unknown");
    assert.ok(Object.isFrozen(receipt.payload.review.reviewer));
  }, true);
});
test("requested accepted agent-only evidence stays effectively inconclusive", async () => {
  await withFixture(async (f) => {
    const { receipt, ref } = await publish(f);
    assert.equal(f.report.outcomes.accepted.count, 1);
    assert.equal(receipt.payload.requested_disposition, "accepted");
    assert.equal(receipt.payload.effective_disposition, "inconclusive");
    assert.equal(receipt.payload.human_calibration.state, "unknown");
    assert.match(
      receipt.payload.disposition_reason,
      /unknown human calibration/,
    );
    const result = await replayGatePromotionReceipt(f.archive, ref, f.current);
    assert.equal(result.eligibility, "inconclusive");
    assert.equal(result.applicability, "matching");
    assert.equal(result.automatic_promotion, false);
  });
});
test("explicit rejected or inconclusive review is preserved when human calibration is unknown", async () => {
  await withFixture(async (f) => {
    for (const disposition of ["rejected", "inconclusive"] as const) {
      const { receipt, ref } = await publish(f, {
        review: { ...f.input.review, disposition },
      });
      assert.equal(receipt.payload.requested_disposition, disposition);
      assert.equal(receipt.payload.effective_disposition, disposition);
      assert.equal(
        (await replayGatePromotionReceipt(f.archive, ref, f.current))
          .eligibility,
        disposition,
      );
    }
  });
});
test("agent reviewer cannot derive accepted eligibility from supplied human label receipts", async () => {
  await withFixture(async (f) => {
    const { receipt, ref } = await publish(f, {
      review: {
        ...f.input.review,
        reviewer: { kind: "agent", id: "agent-control" },
      },
    });
    assert.equal(receipt.payload.human_calibration.state, "known");
    assert.equal(receipt.payload.effective_disposition, "inconclusive");
    assert.equal(
      (await replayGatePromotionReceipt(f.archive, ref, f.current)).eligibility,
      "inconclusive",
    );
  }, true);
});
test("model PASS alone, unsupported override and invented authority cannot create a reviewed receipt", async () => {
  await withFixture(async (f) => {
    const { review: _review, ...unreviewed } = f.input;
    await assert.rejects(
      createGatePromotionReceipt(unreviewed as GatePromotionRequest),
      /missing or unsupported fields/,
    );
    for (const disposition of [
      "override",
      ["accepted"],
      { value: "accepted" },
      true,
      1,
      null,
    ]) {
      await assert.rejects(
        createGatePromotionReceipt({
          ...f.input,
          review: { ...f.input.review, disposition },
        } as unknown as GatePromotionRequest),
        /invalid reviewed disposition/,
      );
    }
    await assert.rejects(
      createGatePromotionReceipt({
        ...f.input,
        review: { ...f.input.review, authority: "host_verified" },
      } as unknown as GatePromotionRequest),
      /authority must remain caller_declared/,
    );
    await assert.rejects(
      createGatePromotionReceipt({
        ...f.input,
        review: { ...f.input.review, evidence_refs: [] },
      }),
      /review evidence required/,
    );
    await assert.rejects(
      createGatePromotionReceipt({
        ...f.input,
        review: { ...f.input.review, rationale: "" },
      }),
      /nonempty text/,
    );
    await assert.rejects(
      createGatePromotionReceipt({
        ...f.input,
        destination: { ...f.input.destination, gate_id: "other" },
      }),
      /destination gate binding mismatch/,
    );
    await assert.rejects(
      createGatePromotionReceipt({
        ...f.input,
        rollback: { ...f.input.rollback, gate_id: "other" },
      }),
      /rollback gate binding mismatch/,
    );
  });
});
test("current gate, suite, rubric, evaluator and selected targets invalidate receipt applicability", async () => {
  await withFixture(async (f) => {
    const { ref } = await publish(f);
    for (const key of [
      "gate_ref",
      "suite_ref",
      "rubric_ref",
      "evaluator_ref",
    ] as const) {
      const current = {
        ...f.current,
        pins: {
          ...f.current.pins,
          [key]: { ...f.current.pins[key], digest: `sha256:${"f".repeat(64)}` },
        },
      };
      const result = await replayGatePromotionReceipt(f.archive, ref, current);
      assert.equal(result.applicability, "stale");
      assert.equal(result.eligibility, "stale");
      assert.deepEqual(result.changed_bindings, [key]);
    }
    const result = await replayGatePromotionReceipt(f.archive, ref, {
      ...f.current,
      selected_target_coverage: [],
    });
    assert.equal(result.eligibility, "stale");
    assert.deepEqual(result.changed_bindings, ["selected_target_coverage"]);
  }, true);
});
test("changed current policy, destination or rollback cannot silently retain eligibility", async () => {
  await withFixture(async (f) => {
    const { ref } = await publish(f);
    const changed = await f.archive.putBlob(
      Buffer.from("different current authority receipt"),
      "text/plain",
    );
    const currents = [
      { ...f.current, policy_ref: changed },
      { ...f.current, destination: { ...f.current.destination, ref: changed } },
      { ...f.current, rollback: { ...f.current.rollback, ref: changed } },
    ];
    for (const [index, current] of currents.entries()) {
      const result = await replayGatePromotionReceipt(f.archive, ref, current);
      assert.equal(result.eligibility, "stale");
      assert.deepEqual(
        result.changed_bindings,
        [["policy_ref"], ["destination"], ["rollback"]][index],
      );
      assert.equal(result.receipt.payload.effective_disposition, "accepted");
    }
    for (const key of ["policy_ref", "destination", "rollback"] as const) {
      const { [key]: _omitted, ...current } = f.current;
      await assert.rejects(
        replayGatePromotionReceipt(
          f.archive,
          ref,
          current as GatePromotionCurrentBinding,
        ),
        /missing or unsupported fields/,
      );
    }
  }, true);
});
test("canonical archived report must equal recomputation including caller-declared missing inventory", async () => {
  await withFixture(async (f) => {
    const wrong = await f.archive.putBlob(
      Buffer.from(canonicalJson({ ...f.report, scope: "full_gate" })),
      "application/json",
    );
    await assert.rejects(
      createGatePromotionReceipt({ ...f.input, report_ref: wrong }),
      /report bytes differ/,
    );
    const pretty = await f.archive.putBlob(
      Buffer.from(JSON.stringify(f.report, null, 2)),
      "application/json",
    );
    await assert.rejects(
      createGatePromotionReceipt({ ...f.input, report_ref: pretty }),
      /report bytes differ/,
    );
    const inventory = [requested(0), requested(99)];
    await assert.rejects(
      createGatePromotionReceipt({ ...f.input, requested: inventory }),
      /report bytes differ/,
    );
    const projected = projectGateCalibration(f.verified, {
      requested: inventory,
    });
    const report_ref = await f.archive.putBlob(
      Buffer.from(canonicalJson(projected)),
      "application/json",
    );
    const { ref } = await publish(f, { requested: inventory, report_ref });
    const result = await replayGatePromotionReceipt(f.archive, ref, f.current);
    assert.equal(result.report.inventory_source, "caller_declared");
    assert.equal(result.report.outcomes.missing.count, 1);
    assert.equal(result.report.outcomes.missing.denominator, 2);
    assert.equal(result.eligibility, "inconclusive");
  });
});
test("rehashed receipt binding, effective decision or automatic mutation claims refuse replay", async () => {
  await withFixture(async (f) => {
    const { receipt } = await publish(f);
    const changes = [
      { effective_disposition: "accepted" },
      { requested_disposition: "rejected" },
      { automatic_promotion: true },
      { human_calibration: { state: "known", authority: "host_verified" } },
      { binding: { ...receipt.payload.binding, selected_target_coverage: [] } },
    ];
    for (const changed of changes) {
      const forged = altered(receipt, {
        ...receipt.payload,
        ...changed,
      } as unknown as ArchiveRecord["payload"]);
      const ref = await f.archive.putRecord(forged);
      await assert.rejects(
        replayGatePromotionReceipt(f.archive, ref, f.current),
        /receipt binding or derived disposition mismatch/,
      );
    }
    const { record_id: _id, ...body } = receipt;
    const undeclared = createArchiveRecord({
      ...body,
      refs: [f.input.invocation_ref],
    });
    const ref = await f.archive.putRecord(undeclared);
    await assert.rejects(
      replayGatePromotionReceipt(f.archive, ref, f.current),
      /evidence missing from dependency refs/,
    );
  });
});
test("canonical closure resolves nested dependencies at refs, provenance, known usage and cost", async () => {
  await withFixture(async (f) => {
    const { receipt } = await publish(f);
    for (const location of ["refs", "provenance", "usage", "cost"] as const) {
      const leaf = await f.archive.putBlob(
        Buffer.from(`nested source ${location}`),
        "text/plain",
      );
      const child = await f.archive.putRecord(evidence({ location }, [leaf]));
      const { record_id: _id, ...body } = receipt;
      const record = createArchiveRecord({
        ...body,
        ...(location === "refs" ? { refs: [...body.refs, child] } : {}),
        ...(location === "provenance"
          ? {
              provenance: {
                ...body.provenance,
                refs: [...body.provenance.refs, child],
              },
            }
          : {}),
        ...(location === "usage"
          ? {
              usage: {
                state: "known",
                unit: "tokens",
                values: { total: 1 },
                source: child,
              },
            }
          : {}),
        ...(location === "cost"
          ? {
              cost: {
                state: "known",
                currency: "USD",
                amount: 0,
                source: child,
              },
            }
          : {}),
      });
      const root = await f.archive.putRecord(record);
      await f.archive.resolveClosure([root]);
      await unlink(file(f.root, leaf));
      await assert.doesNotReject(f.archive.getRecord(root));
      await assert.rejects(f.archive.resolveClosure([root]), /missing/);
      await assert.rejects(
        replayGatePromotionReceipt(f.archive, root, f.current),
        /missing/,
      );
    }
  });
});
test("policy review, destination and rollback dependencies refuse replay when unavailable", async () => {
  await withFixture(async (f) => {
    const { ref } = await publish(f);
    for (const dependency of [
      f.input.policy_ref,
      f.input.destination.ref,
      f.input.rollback.ref,
      ...f.input.review.evidence_refs,
    ]) {
      const bytes =
        dependency.type === "blob"
          ? await f.archive.getBlob(dependency)
          : Buffer.from(canonicalJson(await f.archive.getRecord(dependency)));
      await unlink(file(f.root, dependency));
      await assert.rejects(
        replayGatePromotionReceipt(f.archive, ref, f.current),
        /missing/,
      );
      await writeFile(file(f.root, dependency), bytes, { mode: 0o600 });
    }
  });
});
test("tampered authority blobs and lost archive stay errors rather than successful placeholders", async () => {
  await withFixture(async (f) => {
    const { ref } = await publish(f);
    await writeFile(
      file(f.root, f.input.rollback.ref),
      "tampered rollback bytes",
    );
    await assert.rejects(
      replayGatePromotionReceipt(f.archive, ref, f.current),
      /digest mismatch/,
    );
    await rm(f.root, { recursive: true, force: true });
    await assert.rejects(
      replayGatePromotionReceipt(f.archive, ref, f.current),
      /ENOENT|no such file|missing/,
    );
  });
});
test("review data is detached before async reads; archive publication remains explicit", async () => {
  await withFixture(async (f) => {
    const review = { ...f.input.review };
    const pending = createGatePromotionReceipt({ ...f.input, review });
    review.rationale = "mutated after request";
    review.disposition = "rejected";
    const receipt = await pending;
    assert.equal(receipt.payload.review.rationale, f.input.review.rationale);
    assert.equal(receipt.payload.requested_disposition, "accepted");
    const ref: RecordRef = {
      type: "record",
      kind: "promotion",
      digest: receipt.record_id,
    };
    await assert.rejects(f.archive.getRecord(ref), /missing/);
  });
});
