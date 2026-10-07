import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  hashBytes,
} from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { createArchiveRecord, parseContentRef } from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";
import { createGateSuiteRecord } from "./contracts.ts";
import type { GateSuiteCase, PublicGateRubric } from "./contracts.ts";
import { runGateCalibration, replayGateCalibration } from "./calibration.ts";
import type {
  CalibrationAdapterInput,
  CalibrationAttempt,
} from "./calibration.ts";
function blob(
  content: string,
  mediaType = "text/plain;charset=utf-8",
): Extract<ContentRef, { type: "blob" }> {
  const ref = parseContentRef({
    type: "blob",
    media_type: mediaType,
    digest: hashBytes(content),
  });
  assert.equal(ref.type, "blob");
  return ref as Extract<ContentRef, { type: "blob" }>;
}
const receipt = blob("synthetic agent label review receipt");
const provenance: ArchiveRecord["provenance"] = {
  adapter: { id: "synthetic-calibration-author", version: "1" },
  source: { id: "synthetic-development-controls", version: "1" },
  refs: [receipt],
};

// Callback controls below prove persistence/custody/software adjudication, not model accuracy.
async function calibrationFixture() {
  const root = await mkdtemp(join(tmpdir(), "calibration-invocation-control-"));
  const archive = await EvaluationArchive.open(root);
  await archive.putBlob(
    Buffer.from("synthetic agent label review receipt"),
    receipt.media_type,
  );
  const criteria = [
    "recommendation_actionability",
    "verification_specificity",
  ].map<PublicGateRubric["criteria"][number]>((id) => ({
    type: "semantic_evaluation",
    id,
    question: `Synthetic question for ${id}`,
    target: { kind: "step_output" },
    evidence_requirements: { min_items: 1 },
    result: { kind: "boolean" },
    acceptance: { kind: "equals", value: true },
    allow_not_applicable: false,
  }));
  const definition = {
    id: "synthetic-plan-quality",
    name: "Synthetic control",
    type: "validation",
    description: "Software control",
    guidance: "Synthetic public guidance",
    pass_criteria: criteria,
    evaluation: { mode: "self", strict: true },
  };
  const gateRef = await archive.putBlob(
    Buffer.from(canonicalJson(definition)),
    "application/json",
  );
  const rubric: PublicGateRubric = {
    gate_id: definition.id,
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
      case_id: `synthetic-${family}`,
      family,
      exposure: "development",
      target_ref: await archive.putBlob(
        Buffer.from(`synthetic target ${family}`),
        "text/plain;charset=utf-8",
      ),
      expected_criterion_states: {
        recommendation_actionability: state,
        verification_specificity: "met",
      },
      expected_acceptance: state === "met",
      label_review: {
        state: "reviewed",
        authority: "agent",
        reviewer_id: "synthetic-independent-agent",
        evidence_refs: [receipt],
      },
    });
  }
  cases.push({
    ...cases[0]!,
    case_id: "synthetic-reserved",
    exposure: "reserved",
    target_ref: await archive.putBlob(
      Buffer.from("synthetic reserved target"),
      "text/plain;charset=utf-8",
    ),
  });
  const frozenSuite = createGateSuiteRecord(
    {
      suite_id: "synthetic-suite",
      revision: "1",
      gate_id: rubric.gate_id,
      definition_digest: gateRef.digest,
      criterion_ids: criteria.map((item) => item.id),
      cases,
      human_calibration: {
        state: "unknown",
        reason: "No human receipts supplied for synthetic controls",
      },
    },
    provenance,
    rubric,
  );
  return {
    root,
    archive,
    definition,
    archiveInput: {
      archive,
      suite: frozenSuite,
      public_rubric: rubric,
      gate_snapshot: gateRef,
      evaluator: {
        id: "synthetic-callback",
        revision: "1",
        configuration: { requested_model: "requested-only" },
      },
    },
  };
}
async function withCalibration(
  body: (
    fixture: Awaited<ReturnType<typeof calibrationFixture>>,
  ) => Promise<void>,
) {
  const fixture = await calibrationFixture();
  try {
    await body(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}
function requested(caseId: string, index: number): CalibrationAttempt {
  return {
    case_id: caseId,
    identity: {
      experiment_id: "synthetic-calibration",
      task_id: `task-${index}`,
      variant_id: "software-control",
      client: "synthetic-callback",
      arm: "current",
      repetition: 1,
      attempt_id: `attempt-${index}`,
    },
  };
}
function softwareReport(
  input: CalibrationAdapterInput,
  first: "met" | "unmet" | "insufficient_evidence" = "met",
) {
  return {
    binding: input.binding,
    observations: input.public_rubric.criteria.map((criterion, index) => {
      const state = index === 0 ? first : "met";
      return {
        criterion_id: criterion.id,
        state,
        ...(state === "insufficient_evidence"
          ? {}
          : { value: state === "met" }),
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
        rationale: "Synthetic software report",
      };
    }),
  };
}
async function eventRecords(root: string): Promise<ArchiveRecord[]> {
  const files = await readdir(join(root, "records"));
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(
        async (file) =>
          JSON.parse(
            await readFile(join(root, "records", file), "utf8"),
          ) as ArchiveRecord,
      ),
  );
}

test("calibration kernel binding guards and all-attempt starts preserve actual accepted/rejected/abstained/invalid events", async () =>
  withCalibration(async ({ root, archive, archiveInput }) => {
    const attempts = [
      "positive",
      "negative",
      "insufficient_evidence",
      "boundary",
      "valid_alternative",
      "reserved",
    ].map((family, index) => requested(`synthetic-${family}`, index));
    let calls = 0;
    const run = await runGateCalibration({
      ...archiveInput,
      attempts,
      adapter: async (input) => {
        assert.equal(
          (await eventRecords(root)).filter((record) => record.kind === "trial")
            .length,
          attempts.length,
        );
        assert.deepEqual(Object.keys(input).sort(), [
          "binding",
          "public_rubric",
          "target",
        ]);
        assert.ok(!JSON.stringify(input).includes("expected_criterion_states"));
        const current = calls++;
        const report = softwareReport(
          input,
          current === 1
            ? "unmet"
            : current === 2
              ? "insufficient_evidence"
              : "met",
        );
        if (current === 3)
          return {
            state: "completed",
            report: { ...report, observations: [] },
          };
        if (current === 4)
          return {
            state: "completed",
            report: {
              ...report,
              binding: { ...report.binding, attempt_id: "stale-attempt" },
            },
          };
        return { state: "completed", report };
      },
    });
    assert.equal(calls, 5, "reserved request is retained without a callback");
    const actual = await Promise.all(
      run.attempts.map(
        async (item) =>
          (await archive.getRecord(item.grade_ref)).payload["status"],
      ),
    );
    assert.deepEqual(actual, [
      "accepted",
      "rejected",
      "insufficient_evidence",
      "invalid_report",
      "invalid_report",
      "unattempted",
    ]);
    const replay = await replayGateCalibration(archive, run.invocation_ref);
    assert.deepEqual(
      replay.attempts.map((item) => item.grade.status),
      actual,
    );
    for (const item of run.attempts) {
      const grade = await archive.getRecord(item.grade_ref);
      assert.deepEqual(grade.identity, item.identity);
      assert.equal(grade.cost.state, "unknown");
      assert.equal(grade.usage.state, "unknown");
    }
    assert.equal(replay.attempts[0]!.grade.observed.provenance, "unknown");
    assert.equal(
      replay.evaluator.configuration["requested_model"],
      "requested-only",
    );
    assert.ok(Object.isFrozen(replay.attempts[0]!.grade.adjudication));
  }));

test("duplicate/malformed identities refuse before callbacks; distinct retries append and exact prior starts refuse", async () =>
  withCalibration(async ({ archive, archiveInput }) => {
    let calls = 0;
    const adapter = async (input: CalibrationAdapterInput) => {
      calls++;
      return { state: "completed", report: softwareReport(input) };
    };
    const attempt = requested("synthetic-positive", 0);
    await assert.rejects(
      runGateCalibration({
        ...archiveInput,
        adapter,
        attempts: [attempt, attempt],
      }),
      /duplicate requested identity/,
    );
    await assert.rejects(
      runGateCalibration({
        ...archiveInput,
        adapter,
        attempts: [
          { ...attempt, identity: { ...attempt.identity, repetition: 0 } },
        ],
      }),
      /positive safe integer/,
    );
    await assert.rejects(
      runGateCalibration({
        ...archiveInput,
        adapter,
        attempts: [{ ...attempt, case_id: "unknown" }],
      }),
      /unknown requested case/,
    );
    assert.equal(calls, 0);
    const retry = {
      ...attempt,
      identity: { ...attempt.identity, attempt_id: "retry-1" },
    };
    const run = await runGateCalibration({
      ...archiveInput,
      adapter,
      attempts: [attempt, retry],
    });
    assert.equal(calls, 2);
    assert.notEqual(
      run.attempts[0]!.grade_ref.digest,
      run.attempts[1]!.grade_ref.digest,
    );
    assert.equal(
      (await replayGateCalibration(archive, run.invocation_ref)).attempts
        .length,
      2,
    );
    await assert.rejects(
      runGateCalibration({ ...archiveInput, adapter, attempts: [attempt] }),
      /already started/,
    );
    assert.equal(calls, 2);
  }));

test("callback crash/timeout/incomplete/malformed outcomes stay archived with sanitized errors and client claims", async () =>
  withCalibration(async ({ root, archive, archiveInput }) => {
    const trace = await archive.putBlob(
      Buffer.from("synthetic raw client trace"),
      "text/plain",
    );
    let calls = 0;
    const run = await runGateCalibration({
      ...archiveInput,
      attempts: Array.from({ length: 7 }, (_, index) =>
        requested("synthetic-positive", index),
      ),
      adapter: async (input) => {
        switch (calls++) {
          case 0:
            throw new Error("OPENAI_API_KEY=secret-control-do-not-archive");
          case 1:
            return {
              state: "incomplete",
              code: "timeout",
              artifact_refs: [trace],
            };
          case 2:
            return { state: "error", code: "client_error" };
          case 3:
            return { state: "completed", report: undefined };
          case 4:
            return {
              state: "completed",
              report: { ...softwareReport(input), passed: true },
            };
          case 5:
            return {
              state: "completed",
              report: softwareReport(input),
              observed: { provenance: "host_verified", model: "forged" },
            };
          default:
            return {
              state: "completed",
              report: softwareReport(input),
              observed: {
                provenance: "client_reported",
                model: "claimed-model",
              },
              artifact_refs: [trace],
            };
        }
      },
    });
    const replay = await replayGateCalibration(archive, run.invocation_ref);
    assert.deepEqual(
      replay.attempts.map((item) => item.grade.status),
      [
        "error",
        "incomplete",
        "error",
        "error",
        "invalid_report",
        "error",
        "accepted",
      ],
    );
    assert.deepEqual(replay.attempts[1]!.grade.artifact_refs, [trace]);
    assert.equal(
      replay.attempts[6]!.grade.observed.provenance,
      "client_reported",
    );
    assert.equal(replay.attempts[6]!.grade.observed.model, "claimed-model");
    assert.ok(
      !JSON.stringify(await eventRecords(root)).includes(
        "secret-control-do-not-archive",
      ),
    );
  }));

test("adapter inputs and expected authority are independently detached/frozen against mutation", async () =>
  withCalibration(async ({ archive, archiveInput }) => {
    const runPromise = runGateCalibration({
      ...archiveInput,
      attempts: [requested("synthetic-positive", 0)],
      adapter: async (input) => {
        assert.ok(Object.isFrozen(input.binding));
        assert.ok(Object.isFrozen(input.public_rubric.criteria[0]!.acceptance));
        assert.throws(
          () => Object.assign(input.binding, { attempt_id: "forged" }),
          TypeError,
        );
        assert.throws(
          () =>
            Object.assign(input.public_rubric.criteria[0]!.acceptance, {
              value: false,
            }),
          TypeError,
        );
        assert.throws(
          () => Object.assign(input.target, { content: "forged target" }),
          TypeError,
        );
        return { state: "completed", report: softwareReport(input) };
      },
    });
    Object.assign(archiveInput.public_rubric.criteria[0]!.acceptance, {
      value: false,
    });
    archiveInput.evaluator.configuration.requested_model =
      "changed-after-invocation";
    const run = await runPromise;
    const replay = await replayGateCalibration(archive, run.invocation_ref);
    assert.equal(replay.attempts[0]!.grade.status, "accepted");
    assert.deepEqual(replay.public_rubric.criteria[0]!.acceptance, {
      kind: "equals",
      value: true,
    });
    assert.equal(
      replay.evaluator.configuration["requested_model"],
      "requested-only",
    );
  }));

test("verified target UTF8 preserves BOM/Unicode bytes; invalid UTF8 and unsupported captures never reach adapter", async () =>
  withCalibration(async ({ archive, archiveInput }) => {
    for (const [index, bytes] of [
      Buffer.from("\uFEFFPlan 😀 e\u0301"),
      Buffer.from([0xc3, 0x28]),
    ].entries()) {
      const target = await archive.putBlob(bytes, "text/plain;charset=utf-8");
      const changedSuite = createGateSuiteRecord(
        {
          ...archiveInput.suite.payload,
          revision: `utf8-${index}`,
          cases: archiveInput.suite.payload.cases.map((item, at) =>
            at === 0 ? { ...item, target_ref: target } : item,
          ),
        },
        provenance,
        archiveInput.public_rubric,
      );
      let calls = 0;
      const run = await runGateCalibration({
        ...archiveInput,
        suite: changedSuite,
        attempts: [requested("synthetic-positive", index)],
        adapter: async (input) => {
          calls++;
          assert.equal(input.target.content, "\uFEFFPlan 😀 e\u0301");
          assert.equal(
            hashBytes(input.target.content),
            input.target.ref.digest,
          );
          return { state: "completed", report: softwareReport(input) };
        },
      });
      const replay = await replayGateCalibration(archive, run.invocation_ref);
      assert.equal(calls, index === 0 ? 1 : 0);
      assert.equal(
        replay.attempts[0]!.grade.status,
        index === 0 ? "accepted" : "error",
      );
    }
    const rubric = {
      ...archiveInput.public_rubric,
      criteria: archiveInput.public_rubric.criteria.map((item) => ({
        ...item,
        target: {
          kind: "artifact" as const,
          id: "unsupported-declared-artifact",
        },
      })),
    };
    const gate = await archive.putBlob(
      Buffer.from(
        canonicalJson({
          ...objectDefinition(archiveInput),
          pass_criteria: rubric.criteria,
        }),
      ),
      "application/json",
    );
    Object.assign(rubric, { definition_digest: gate.digest });
    const artifactSuite = createGateSuiteRecord(
      { ...archiveInput.suite.payload, definition_digest: gate.digest },
      provenance,
      rubric,
    );
    const run = await runGateCalibration({
      ...archiveInput,
      suite: artifactSuite,
      public_rubric: rubric,
      gate_snapshot: gate,
      attempts: [requested("synthetic-positive", 10)],
      adapter: async () => {
        assert.fail("unsupported capture must not invoke adapter");
      },
    });
    assert.equal(
      (await replayGateCalibration(archive, run.invocation_ref)).attempts[0]!
        .grade.error!.code,
      "unsupported_target",
    );
  }));
function objectDefinition(
  input: Awaited<ReturnType<typeof calibrationFixture>>["archiveInput"],
) {
  return {
    id: input.public_rubric.gate_id,
    pass_criteria: input.public_rubric.criteria,
    guidance: "Synthetic public guidance",
    evaluation: { mode: "self" },
  };
}

test("snapshot binding checks refuse stale rubric/gate/private paths and noncanonical bytes before callbacks", async () =>
  withCalibration(async ({ archive, archiveInput, definition }) => {
    for (const change of [
      { ...definition, id: "stale" },
      { ...definition, guidance: 1 },
      { ...definition, sourceRoot: "/private-path" },
      { ...definition, evaluation: { mode: "unknown" } },
      {
        ...definition,
        pass_criteria: definition.pass_criteria.map((item) => ({
          ...item,
          question: "changed question",
        })),
      },
    ]) {
      const ref = await archive.putBlob(
        Buffer.from(canonicalJson(change)),
        "application/json",
      );
      const rubric = {
        ...archiveInput.public_rubric,
        definition_digest: ref.digest,
      };
      const changedSuite = createGateSuiteRecord(
        { ...archiveInput.suite.payload, definition_digest: ref.digest },
        provenance,
        rubric,
      );
      await assert.rejects(
        runGateCalibration({
          ...archiveInput,
          suite: changedSuite,
          public_rubric: rubric,
          gate_snapshot: ref,
          attempts: [requested("synthetic-positive", 0)],
          adapter: async () => {
            assert.fail("invalid snapshot invoked adapter");
          },
        }),
        /snapshot|evaluation|rubric/,
      );
    }
    const prettyRef = await archive.putBlob(
      Buffer.from(JSON.stringify(definition, null, 2)),
      "application/json",
    );
    await assert.rejects(
      runGateCalibration({
        ...archiveInput,
        gate_snapshot: prettyRef,
        attempts: [requested("synthetic-positive", 0)],
        adapter: async () => null,
      }),
      /digest mismatch/,
    );
  }));

test("mixed snapshots adjudicate semantic components while full gate/tool acceptance remains not assessed", async () =>
  withCalibration(async ({ archive, archiveInput, definition }) => {
    const snapshot = {
      ...definition,
      pass_criteria: [
        { type: "shell_verify", shell_command: "false" },
        ...definition.pass_criteria,
      ],
    };
    const ref = await archive.putBlob(
      Buffer.from(canonicalJson(snapshot)),
      "application/json",
    );
    const rubric = {
      ...archiveInput.public_rubric,
      definition_digest: ref.digest,
    };
    const mixed = createGateSuiteRecord(
      { ...archiveInput.suite.payload, definition_digest: ref.digest },
      provenance,
      rubric,
    );
    const run = await runGateCalibration({
      ...archiveInput,
      suite: mixed,
      public_rubric: rubric,
      gate_snapshot: ref,
      attempts: [requested("synthetic-positive", 0)],
      adapter: async (input) => ({
        state: "completed",
        report: softwareReport(input),
      }),
    });
    const replay = await replayGateCalibration(archive, run.invocation_ref);
    assert.equal(replay.attempts[0]!.grade.status, "accepted");
    assert.equal(replay.attempts[0]!.grade.scope, "semantic_components");
    assert.equal(
      replay.attempts[0]!.grade.gate_acceptance.state,
      "not_assessed",
    );
  }));

test("archive publication errors remain fatal and replay survives runtime loss but refuses missing/corrupt/stale custody", async () =>
  withCalibration(async ({ root, archive, archiveInput }) => {
    const adapter = async (input: CalibrationAdapterInput) => ({
      state: "completed",
      report: softwareReport(input),
    });
    const run = await runGateCalibration({
      ...archiveInput,
      attempts: [requested("synthetic-positive", 0)],
      adapter,
    });
    const runtime = join(root, "disposable-runtime-state");
    await mkdir(runtime);
    await writeFile(join(runtime, "state.db"), "unrelated disposable state");
    await rm(runtime, { recursive: true });
    const replay = await replayGateCalibration(
      await EvaluationArchive.open(root),
      run.invocation_ref,
    );
    assert.equal(replay.attempts[0]!.grade.status, "accepted");
    const gradeRef = replay.attempts[0]!.grade_ref;
    const grade = await archive.getRecord(gradeRef);
    const { record_id: _recordId, ...body } = grade;
    const alteredGrade = await archive.putRecord(
      createArchiveRecord({
        ...body,
        payload: {
          ...body.payload,
          binding: {
            ...replay.attempts[0]!.grade.binding,
            attempt_id: "stale",
          },
        },
      }),
    );
    const invocation = await archive.getRecord(run.invocation_ref);
    const { record_id: _invocationId, ...invocationBody } = invocation;
    const staleRun = await archive.putRecord(
      createArchiveRecord({
        ...invocationBody,
        refs: [...invocationBody.refs, alteredGrade],
        payload: {
          ...invocationBody.payload,
          attempts: [{ ...run.attempts[0]!, grade_ref: alteredGrade }],
        },
      }),
    );
    await assert.rejects(
      replayGateCalibration(archive, staleRun),
      /replay identity\/binding/,
    );
    const raw = replay.attempts[0]!.grade.raw_report_ref!;
    const rawPath = join(root, "blobs", raw.digest.slice(7));
    const original = await readFile(rawPath);
    await writeFile(rawPath, "corrupt");
    await assert.rejects(
      replayGateCalibration(archive, run.invocation_ref),
      /digest mismatch/,
    );
    await writeFile(rawPath, original);
    await rm(rawPath);
    await assert.rejects(
      replayGateCalibration(archive, run.invocation_ref),
      /missing/,
    );
    const missing = blob("undeclared missing trace", "text/plain");
    await assert.rejects(
      runGateCalibration({
        ...archiveInput,
        attempts: [
          requested("synthetic-positive", 11),
          requested("synthetic-positive", 12),
        ],
        adapter: async (input) => ({
          state: "completed",
          report: softwareReport(input),
          artifact_refs: [missing],
        }),
      }),
      /missing/,
    );
    assert.ok(
      (await eventRecords(root)).filter((item) => item.kind === "trial")
        .length >= 3,
      "failed publication retained every requested start",
    );
  }));

function declaredDependency(
  record: ArchiveRecord,
  extra: ContentRef,
  location: "refs" | "provenance" | "usage" | "cost",
) {
  const { record_id: _recordId, ...body } = record;
  return createArchiveRecord({
    ...body,
    ...(location === "refs" ? { refs: [...body.refs, extra] } : {}),
    ...(location === "provenance"
      ? {
          provenance: {
            ...body.provenance,
            refs: [...body.provenance.refs, extra],
          },
        }
      : {}),
    ...(location === "usage"
      ? {
          usage: {
            state: "known" as const,
            unit: "synthetic",
            values: { count: 1 },
            source: extra,
          },
        }
      : {}),
    ...(location === "cost"
      ? {
          cost: {
            state: "known" as const,
            currency: "USD",
            amount: 1,
            source: extra,
          },
        }
      : {}),
  });
}

test("replay resolves every declared dependency of the actual selected grade envelope", async () =>
  withCalibration(async ({ root, archive, archiveInput }) => {
    const run = await runGateCalibration({
      ...archiveInput,
      attempts: [requested("synthetic-positive", 0)],
      adapter: async (input) => ({
        state: "completed",
        report: softwareReport(input),
      }),
    });
    const originalGrade = await archive.getRecord(run.attempts[0]!.grade_ref);
    const { record_id: _invocationId, ...originalInvocation } =
      await archive.getRecord(run.invocation_ref);
    for (const location of ["refs", "provenance", "usage", "cost"] as const) {
      const extra = await archive.putBlob(
        Buffer.from(`synthetic selected-grade ${location}`),
        "text/plain",
      );
      const selected = await archive.putRecord(
        declaredDependency(originalGrade, extra, location),
      );
      // Payload selects the equivalent new grade; outer refs deliberately retain the old grade.
      const manifest = await archive.putRecord(
        createArchiveRecord({
          ...originalInvocation,
          payload: {
            ...originalInvocation.payload,
            attempts: [{ ...run.attempts[0]!, grade_ref: selected }],
          },
        }),
      );
      assert.equal(
        (await replayGateCalibration(archive, manifest)).attempts[0]!.grade
          .status,
        "accepted",
      );
      await rm(join(root, "blobs", extra.digest.slice(7)));
      await assert.rejects(
        replayGateCalibration(archive, manifest),
        /missing/,
        `selected grade ${location} dependency loss must refuse replay`,
      );
    }
  }));

test("replay resolves root invocation known measurement sources", async () =>
  withCalibration(async ({ root, archive, archiveInput }) => {
    const run = await runGateCalibration({
      ...archiveInput,
      attempts: [requested("synthetic-positive", 0)],
      adapter: async (input) => ({
        state: "completed",
        report: softwareReport(input),
      }),
    });
    const originalInvocation = await archive.getRecord(run.invocation_ref);
    for (const location of ["usage", "cost"] as const) {
      const source = await archive.putBlob(
        Buffer.from(`synthetic root measurement ${location}`),
        "text/plain",
      );
      const manifest = await archive.putRecord(
        declaredDependency(originalInvocation, source, location),
      );
      assert.equal(
        (await replayGateCalibration(archive, manifest)).attempts[0]!.grade
          .status,
        "accepted",
      );
      await rm(join(root, "blobs", source.digest.slice(7)));
      await assert.rejects(
        replayGateCalibration(archive, manifest),
        /missing/,
        `root ${location} source loss must refuse replay`,
      );
    }
  }));
