import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SemanticCriterionSchema } from "../../server/src/engine/gates/core/gate-schema.ts";
import type { SemanticCriterionInput } from "../../server/src/shared/types/gate-evaluation.ts";
import { refuseUndeclaredKey } from "../../server/src/shared/utils/nested-key-refusal.ts";
import {
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { EvaluationArchive } from "../core/archive.ts";
import { parseContentRef } from "../core/contracts.ts";
import type { ArchiveRecord, ContentRef } from "../core/contracts.ts";
import {
  createGateSuiteRecord,
  gateSuiteReadiness,
  parseGateSuiteRecord,
  projectGateSuiteCase,
} from "./contracts.ts";

import type {
  GateCaseFamily,
  GateSuiteCase,
  GateSuitePayload,
  PublicGateRubric,
} from "./contracts.ts";

// Synthetic development controls only: no actual private pilot targets or frozen pilot labels.
const gateBytes = "synthetic public gate definition v1";
const publicRubric: PublicGateRubric = {
  gate_id: "synthetic-plan-quality",
  definition_digest: hashBytes(gateBytes) as ContentRef["digest"],
  criteria: ["recommendation_actionability", "verification_specificity"].map(
    (id) => ({
      type: "semantic_evaluation",
      id,
      question: `Synthetic question for ${id}`,
      target: { kind: "step_output" },
      evidence_requirements: { min_items: 1 },
      result: { kind: "boolean" },
      acceptance: { kind: "equals", value: true },
      allow_not_applicable: false,
    }),
  ),
};
const familyNames: readonly GateCaseFamily[] = [
  "positive",
  "negative",
  "valid_alternative",
  "boundary",
  "insufficient_evidence",
];
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
  adapter: { id: "gate-suite-author", version: "1" },
  source: { id: "synthetic-development-controls", version: "1" },
  refs: [receipt],
};
function payload(): GateSuitePayload {
  const cases = familyNames.map<GateSuiteCase>((family) => {
    const first =
      family === "negative"
        ? "unmet"
        : family === "insufficient_evidence"
          ? "insufficient_evidence"
          : "met";
    return {
      case_id: `synthetic-${family}`,
      target_ref: blob(`synthetic target ${family}`),
      family,
      exposure: "development" as const,
      expected_criterion_states: {
        recommendation_actionability: first,
        verification_specificity: "met" as const,
      },
      expected_acceptance: first === "met",
      label_review: {
        state: "reviewed" as const,
        authority: "agent" as const,
        reviewer_id: "synthetic-independent-agent",
        evidence_refs: [receipt],
      },
    };
  });
  return {
    suite_id: "synthetic-suite",
    revision: "1",
    gate_id: publicRubric.gate_id,
    definition_digest: publicRubric.definition_digest,
    criterion_ids: publicRubric.criteria.map((item) => item.id),
    cases: [
      ...cases,
      {
        ...cases[0]!,
        case_id: "synthetic-reserved",
        target_ref: blob("synthetic reserved target"),
        exposure: "reserved",
      },
    ],
    human_calibration: {
      state: "unknown",
      reason: "No human receipts supplied for these synthetic controls",
    },
  };
}
function suite() {
  return createGateSuiteRecord(payload(), provenance, publicRubric);
}
type JsonObject = Record<string, unknown>;
function mutable(): JsonObject {
  return structuredClone(suite()) as unknown as JsonObject;
}
function fields(record: JsonObject): JsonObject {
  return record["payload"] as JsonObject;
}
function cases(record: JsonObject): JsonObject[] {
  return fields(record)["cases"] as JsonObject[];
}
function firstCase(record: JsonObject): JsonObject {
  return cases(record)[0]!;
}
function rehash(record: JsonObject): JsonObject {
  const { record_id: _recordId, ...body } = record;
  return { ...body, record_id: hashCanonical(body) };
}
function refuses(
  change: (record: JsonObject) => void,
  expected: RegExp = /gate suite|ref|payload/,
): void {
  const record = mutable();
  change(record);
  assert.throws(
    () => parseGateSuiteRecord(rehash(record), publicRubric),
    expected,
  );
}

test("canonical schema types admit Zod's explicit undefined defaults and issue paths", () => {
  const authored: SemanticCriterionInput = {
    ...publicRubric.criteria[0]!,
    allow_not_applicable: undefined,
  };
  assert.equal(
    SemanticCriterionSchema.parse(authored).allow_not_applicable,
    false,
  );
  assert.match(
    refuseUndeclaredKey({
      code: "unrecognized_keys",
      path: undefined,
      keys: ["misspelled"],
    })!,
    /misspelled/,
  );
  assert.throws(
    () => SemanticCriterionSchema.parse({ ...authored, typo: true }),
    /typo/,
  );
});

test("suite identity freezes labels and revisions independently of gate bytes", () => {
  const input = payload();
  const original = createGateSuiteRecord(input, provenance, publicRubric);
  const second = createGateSuiteRecord(
    { ...input, revision: "2" },
    provenance,
    publicRubric,
  );
  assert.notEqual(original.record_id, second.record_id);
  const relabeled = createGateSuiteRecord(
    {
      ...input,
      cases: input.cases.map((item) =>
        item.family === "boundary"
          ? {
              ...item,
              expected_criterion_states: {
                recommendation_actionability: "unmet",
                verification_specificity: "met",
              },
              expected_acceptance: false,
            }
          : item,
      ),
    },
    provenance,
    publicRubric,
  );
  assert.equal(relabeled.payload.revision, original.payload.revision);
  assert.notEqual(
    relabeled.record_id,
    original.record_id,
    "aliases cannot authorize label reuse",
  );
  assert.equal(original.payload.definition_digest, hashBytes(gateBytes));
  assert.equal(
    second.payload.definition_digest,
    original.payload.definition_digest,
  );
  assert.equal(hashBytes(gateBytes), publicRubric.definition_digest);
  assert.deepEqual(
    parseGateSuiteRecord(JSON.parse(JSON.stringify(original)), publicRubric),
    original,
  );
  assert.ok(
    Object.isFrozen(original.payload.cases[0]!.expected_criterion_states),
  );
  assert.ok(Object.isFrozen(original.payload.cases[0]!.label_review));
  assert.throws(() => {
    Object.assign(original.payload, { revision: "3" });
  }, TypeError);
  const reordered = {
    ...input,
    human_calibration: {
      reason:
        input.human_calibration.state === "unknown"
          ? input.human_calibration.reason
          : "unused",
      state: "unknown" as const,
    },
  };
  assert.equal(
    createGateSuiteRecord(reordered, provenance, publicRubric).record_id,
    original.record_id,
  );
});

test("malformed revisions, duplicate IDs and rehashed unsupported controls are refused", () => {
  for (const revision of ["", " ", 1, null])
    refuses((record) => {
      fields(record)["revision"] = revision;
    });
  refuses((record) => {
    fields(record)["suite_id"] = "";
  });
  refuses((record) => {
    fields(record)["criterion_ids"] = [
      "recommendation_actionability",
      "recommendation_actionability",
    ];
  }, /duplicate/);
  refuses((record) => {
    fields(record)["criterion_ids"] = [
      "verification_specificity",
      "recommendation_actionability",
    ];
  }, /exact public/);
  refuses((record) => {
    fields(record)["criterion_ids"] = ["recommendation_actionability"];
  }, /exact public/);
  refuses((record) => {
    cases(record).push(firstCase(record));
  }, /duplicate/);
  refuses((record) => {
    firstCase(record)["case_id"] = "";
  });
  refuses((record) => {
    fields(record)["promotion_answers"] = "accept";
  }, /exact fields/);
  refuses((record) => {
    firstCase(record)["private_target_text"] = "forbidden";
  }, /exact fields/);
  refuses((record) => {
    firstCase(record)["family"] = "invented";
  }, /family/);
  refuses((record) => {
    firstCase(record)["exposure"] = "public";
  }, /exposure/);
  refuses((record) => {
    record["kind"] = "task";
  }, /suite envelope/);
});

test("tampering, public binding drift and malformed or undeclared target/review refs fail", () => {
  const record = mutable();
  fields(record)["revision"] = "tampered";
  assert.throws(
    () => parseGateSuiteRecord(record, publicRubric),
    /digest does not match/,
  );
  refuses((record) => {
    fields(record)["definition_digest"] = "sha256:bad";
  }, /canonical sha256/);
  refuses((record) => {
    fields(record)["definition_digest"] = hashBytes("another gate");
  }, /binding mismatch/);
  refuses((record) => {
    fields(record)["gate_id"] = "another gate";
  }, /binding mismatch/);
  refuses((record) => {
    firstCase(record)["target_ref"] = {
      type: "record",
      kind: "task",
      digest: hashBytes("target"),
    };
  }, /UTF-8/);
  refuses((record) => {
    firstCase(record)["target_ref"] = blob("bytes", "application/json");
  }, /UTF-8/);
  refuses((record) => {
    (firstCase(record)["target_ref"] as JsonObject)["digest"] = "bad";
  }, /canonical sha256/);
  refuses((record) => {
    record["refs"] = [];
  }, /missing from envelope/);
  refuses((record) => {
    (firstCase(record)["label_review"] as JsonObject)["evidence_refs"] = [
      blob("undeclared receipt"),
    ];
  }, /missing from envelope/);
  const duplicateRubric = {
    ...publicRubric,
    criteria: [publicRubric.criteria[0]!, publicRubric.criteria[0]!],
  };
  assert.throws(
    () => parseGateSuiteRecord(suite(), duplicateRubric),
    /duplicate/,
  );
  const invalidRubric = {
    ...publicRubric,
    criteria: [
      {
        ...publicRubric.criteria[0]!,
        acceptance: { kind: "gte" as const, value: 2 },
      },
    ],
  };
  assert.throws(
    () => parseGateSuiteRecord(suite(), invalidRubric),
    /Acceptance must match/,
  );
});

test("complete expected states and acceptance must cohere with public N/A and family semantics", () => {
  refuses((record) => {
    firstCase(record)["expected_criterion_states"] = {
      recommendation_actionability: "met",
    };
  }, /exact fields/);
  refuses((record) => {
    (firstCase(record)["expected_criterion_states"] as JsonObject)[
      "unknown_criterion"
    ] = "met";
  }, /exact fields/);
  refuses((record) => {
    (firstCase(record)["expected_criterion_states"] as JsonObject)[
      "verification_specificity"
    ] = "invalid";
  }, /expected criterion state/);
  refuses((record) => {
    (firstCase(record)["expected_criterion_states"] as JsonObject)[
      "verification_specificity"
    ] = "not_applicable";
  }, /N\/A denied/);
  refuses((record) => {
    firstCase(record)["expected_acceptance"] = false;
  }, /acceptance disagrees/);
  refuses((record) => {
    firstCase(record)["expected_acceptance"] = "true";
  }, /acceptance disagrees/);
  refuses((record) => {
    firstCase(record)["expected_acceptance"] = false;
    (firstCase(record)["expected_criterion_states"] as JsonObject)[
      "verification_specificity"
    ] = "unmet";
  }, /positive\/valid-alternative/);
  refuses((record) => {
    firstCase(record)["family"] = "negative";
  }, /negative labels/);
  refuses((record) => {
    firstCase(record)["family"] = "insufficient_evidence";
  }, /missing evidence/);
  const allowed = {
    ...publicRubric,
    criteria: publicRubric.criteria.map((item) => ({
      ...item,
      allow_not_applicable: true,
    })),
  };
  const na = mutable();
  (firstCase(na)["expected_criterion_states"] as JsonObject)[
    "verification_specificity"
  ] = "not_applicable";
  assert.equal(
    parseGateSuiteRecord(rehash(na), allowed).payload.cases[0]!
      .expected_acceptance,
    true,
  );
});

test("pilot readiness requires each reviewed family, all reviewed labels and a private reserved slice", () => {
  assert.deepEqual(gateSuiteReadiness(suite(), publicRubric), {
    ready: true,
    reasons: [],
    human_calibration: payload().human_calibration,
  });
  for (const family of familyNames) {
    const missing = mutable();
    fields(missing)["cases"] = cases(missing).filter(
      (item) => item["family"] !== family,
    );
    const readiness = gateSuiteReadiness(rehash(missing), publicRubric);
    assert.equal(
      readiness.ready,
      false,
      `removing ${family} must block pilot readiness`,
    );
    assert.ok(readiness.reasons.includes(`missing reviewed family: ${family}`));
  }
  const unreviewed = mutable();
  firstCase(unreviewed)["label_review"] = {
    state: "unreviewed",
    reason: "awaiting independent review",
  };
  assert.doesNotThrow(() =>
    parseGateSuiteRecord(rehash(unreviewed), publicRubric),
  );
  assert.equal(
    gateSuiteReadiness(rehash(unreviewed), publicRubric).ready,
    false,
  );
  const exposed = mutable();
  cases(exposed).at(-1)!["exposure"] = "development";
  assert.deepEqual(gateSuiteReadiness(rehash(exposed), publicRubric).reasons, [
    "missing reserved slice",
  ]);
  const reservedOnly = mutable();
  fields(reservedOnly)["cases"] = cases(reservedOnly).filter(
    (item) => item["case_id"] !== "synthetic-positive",
  );
  assert.deepEqual(
    gateSuiteReadiness(rehash(reservedOnly), publicRubric).reasons,
    ["missing reviewed family: positive"],
  );
});

test("agent labels remain agent-reviewed; known human calibration requires supplied human receipts", () => {
  assert.equal(
    gateSuiteReadiness(suite(), publicRubric).human_calibration.state,
    "unknown",
  );
  refuses((record) => {
    fields(record)["human_calibration"] = {
      state: "known",
      reviewer_id: "claimed-human",
      evidence_refs: [receipt],
    };
  }, /cannot establish human/);
  refuses((record) => {
    firstCase(record)["label_review"] = {
      state: "reviewed",
      authority: "host_verified",
      reviewer_id: "x",
      evidence_refs: [receipt],
    };
  }, /authority/);
  refuses((record) => {
    (firstCase(record)["label_review"] as JsonObject)["reviewer_id"] = "";
  });
  refuses((record) => {
    (firstCase(record)["label_review"] as JsonObject)["evidence_refs"] = [];
  }, /nonempty list/);
  refuses((record) => {
    fields(record)["human_calibration"] = { state: "unknown" };
  }, /exact fields/);
  const supplied = mutable();
  for (const item of cases(supplied))
    (item["label_review"] as JsonObject)["authority"] = "human";
  fields(supplied)["human_calibration"] = {
    state: "known",
    reviewer_id: "supplied-human-reviewer",
    evidence_refs: [receipt],
  };
  assert.equal(
    parseGateSuiteRecord(rehash(supplied), publicRubric).payload
      .human_calibration.state,
    "known",
  );
  (fields(supplied)["human_calibration"] as JsonObject)["evidence_refs"] = [];
  assert.throws(
    () => parseGateSuiteRecord(rehash(supplied), publicRubric),
    /nonempty list/,
  );
});

test("adapter projection excludes expected labels, families, exposure and private sibling answers", () => {
  const record = suite();
  const projection = projectGateSuiteCase(
    record,
    "synthetic-negative",
    publicRubric,
  );
  assert.deepEqual(Object.keys(projection).sort(), [
    "criterion_ids",
    "public_rubric",
    "target_ref",
  ]);
  assert.deepEqual(projection.public_rubric, publicRubric);
  assert.deepEqual(projection.target_ref, record.payload.cases[1]!.target_ref);
  assert.deepEqual(projection.criterion_ids, record.payload.criterion_ids);
  assert.ok(JSON.stringify(record).includes("expected_criterion_states")); // positive observation control
  const encoded = JSON.stringify(projection);
  for (const key of [
    "expected_criterion_states",
    "expected_acceptance",
    "family",
    "exposure",
    "cases",
    "label_review",
    "human_calibration",
    "promotion_answers",
    "synthetic-reserved",
  ])
    assert.ok(!encoded.includes(`"${key}"`), key);
  for (const sibling of record.payload.cases.filter(
    (item) => item.case_id !== "synthetic-negative",
  ))
    assert.ok(!encoded.includes(sibling.target_ref.digest));
  assert.throws(
    () => projectGateSuiteCase(record, "synthetic-reserved", publicRubric),
    /reserved cases/,
  );
  assert.throws(
    () => projectGateSuiteCase(record, "unknown-case", publicRubric),
    /unknown selected/,
  );
  const anchor = mutable();
  firstCase(anchor)["exposure"] = "runtime_anchor";
  assert.doesNotThrow(() =>
    projectGateSuiteCase(rehash(anchor), "synthetic-positive", publicRubric),
  );
});

test("suite specialization lifts private dependencies into the canonical real archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "gate-suite-control-"));
  try {
    const archive = await EvaluationArchive.open(root);
    await archive.putBlob(
      Buffer.from("synthetic agent label review receipt"),
      receipt.media_type,
    );
    for (const family of familyNames)
      await archive.putBlob(
        Buffer.from(`synthetic target ${family}`),
        "text/plain;charset=utf-8",
      );
    await archive.putBlob(
      Buffer.from("synthetic reserved target"),
      "text/plain;charset=utf-8",
    );
    const original = suite();
    assert.equal(original.refs.length, 7);
    const ref = await archive.putRecord(original);
    assert.deepEqual(
      parseGateSuiteRecord(await archive.getRecord(ref), publicRubric),
      original,
    );
    const missingPayload = {
      ...payload(),
      cases: payload().cases.map((item, index) =>
        index === 0 ? { ...item, target_ref: blob("not stored") } : item,
      ),
    };
    await assert.rejects(
      archive.putRecord(
        createGateSuiteRecord(missingPayload, provenance, publicRubric),
      ),
      /missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review authority requires a literal string even in a rehashed suite envelope", () => {
  for (const authority of [
    ["agent"],
    ["human"],
    { value: "agent" },
    1,
    true,
    null,
  ]) {
    refuses((record) => {
      (firstCase(record)["label_review"] as JsonObject)["authority"] =
        authority;
    }, /authority/);
  }
});
