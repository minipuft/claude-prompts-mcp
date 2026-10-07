# Optional evaluation evidence archive

This private, repository-local Node24 TypeScript package provides immutable evaluation
records, content-addressed evidence blobs and private gate-suite contracts. Use it
explicitly from a checkout; it does not join the root workspace or default server startup.
Its generic [contracts](core/contracts.ts) and [archive](core/archive.ts) import the existing
[canonical hash source](../server/src/shared/utils/hash.ts) outside this directory, so
the package is not an independently published library. Gate specialization also uses
the server's locked dependencies and source loader; this package adds no dependency or
separate model-provider SDK.

## Setup and checks

Use Node24 on Linux. Core contracts/archive tests use Node's native TypeScript stripping
without a build. Gate-suite tests import the canonical server
[`SemanticCriterionSchema`](../server/src/engine/gates/core/gate-schema.ts) through the
existing server-lockfile-pinned `tsx` loader: native stripping cannot resolve the server
source graph's `.js` specifiers. Gate contracts therefore require that repository-local
tooling when executed; they are not a standalone native-only runtime. Strict typechecking
separately uses TypeScript and Node types from the server's locked development toolchain.

From the repository root, install those tools **only in a standalone checkout with its
own dependency directories**:

```bash
npm ci --prefix server --include=dev --ignore-scripts
```

Do not run `npm ci` or another install through a linked worktree's `node_modules` or
`server/node_modules` symlinks: that changes the shared checkout's dependencies. If those
tools are already available, run the checks directly without installing anything:

```bash
npm --prefix evaluations test
npm --prefix evaluations run typecheck
```

`npm test` runs `test:core` followed by `test:gates`. To run one boundary directly from
the repository root:

```bash
npm --prefix evaluations run test:core
npm --prefix evaluations run test:gates
```

`test:core` runs `node --test tests/*.test.ts`; `test:gates` runs
`node --import ../server/node_modules/tsx/dist/loader.mjs --test gates/*.test.ts` inside
this directory. Both exercise real canonical collaborators and temporary filesystems,
make no model calls and need no provider credentials. The optional
[CI workflow](../.github/workflows/evaluations.yml) uses a fresh Ubuntu checkout and Node24
to run native core controls, explicit gate-loader controls, then strict package types.
Its path filters cover this package and the imported server gate/shared sources; it is
unsuitable as a required branch-protection context. Local checks do not establish that
a hosted workflow ran successfully.

## Private gate-suite contracts

The [gate specialization](gates/contracts.ts) validates public criteria through the
canonical server schema, using the shared criterion types. It specializes the existing
`suite` archive payload rather than creating a second archive or gate-definition authority.
It supplies suite contracts, readiness checks, an adapter-facing projection, explicit
callback invocation, verified replay and a pure report projection. Committed gate tests are
synthetic development controls, not actual private pilot cases or evidence of model accuracy.

Each suite binds its ID/revision aliases, gate ID/definition digest and exact ordered
criterion IDs. Cases carry UTF-8 target blob references, complete expected criterion
states/acceptance, family, exposure and label-review receipts. Exact archive `record_id`
is the revision identity: changing labels changes that digest even when an author reuses
a revision alias. Gate resources must not embed expected labels or case material; private
suite data stays in the operator-selected evaluation root outside Git. Runtime association
authoring remains part of pending activation.

Structural pilot readiness requires reviewed, nonreserved cases in all five families:
positive, negative, valid alternative, boundary and insufficient evidence. It also requires
a reserved slice and refuses readiness when any labels are unreviewed. This is a structural
coverage check, not a statistical adequacy or promotion threshold. Ordinary adapter projection
accepts a selected development/runtime-anchor case and returns only its target reference,
public rubric binding and criterion IDs. It excludes expected labels, family/exposure,
review/promotion answers and sibling cases; selecting a reserved case is refused. Reserved
cases remain private and unattempted through this projection.

Label receipts explicitly distinguish agent from human review. Human calibration stays
`unknown` with a reason unless a caller supplies human receipts and every case is human-reviewed.
Those references and reviewer identifiers represent supplied authority, not verified human
identity or proof that the review occurred. Agent review cannot establish human calibration,
and readiness alone grants no automatic promotion authority. Suite targets and review receipts
are lifted into the canonical archive's dependency references so publication resolves them.

## Explicit calibration invocation and reports

[`runGateCalibration`](gates/calibration.ts) takes an opened archive, private suite,
public rubric, canonical resolved gate snapshot blob, evaluator metadata, an explicit
attempt inventory and an asynchronous callback. There is no provider integration or
automatic client selection. The caller owns client execution, deadlines, cancellation
and globally unique attempt identities. Each attempt uses all seven canonical identity
fields: `experiment_id`, `task_id`, `variant_id`, `client`, `arm`, `repetition` and
`attempt_id`. Duplicate identities within a request and an identical already-started
trial are refused; the existing-start check is not an atomic global identity registry.
Allocate a fresh identity for every retry and coordinate concurrent callers yourself.

The callback receives only target content/reference, public rubric and an independently
pinned report binding. It returns `{ state: "completed", report }`,
`{ state: "incomplete", code: "timeout" | "cancelled" | "no_report" }`, or
`{ state: "error", code: "client_error" | "timeout" }`, with optional `observed`
and `artifact_refs`. A callback exception becomes an error outcome; malformed reports
remain invalid outcomes. Archive failures propagate. Reserved cases and currently
unsupported artifact targets are recorded as unattempted without calling the adapter.
Every accepted request archives its immutable trial starts before invoking callbacks.

Use the existing server `tsx` loader for a checkout script importing these `.ts` APIs:

```typescript
import {
  runGateCalibration,
  replayGateCalibration,
} from "./gates/calibration.ts";
import {
  projectGateCalibration,
  compareGateCalibrationReports,
} from "./gates/report.ts";

// invocationOptions supplies archive, suite, public_rubric, gate_snapshot,
// evaluator, attempts and the caller's adapter implementation.
const run = await runGateCalibration(invocationOptions);
const verified = await replayGateCalibration(
  invocationOptions.archive,
  run.invocation_ref,
);
const report = projectGateCalibration(verified);
// Optional planned inventory may include attempts absent from this verified invocation.
const withMissing = projectGateCalibration(verified, {
  requested: plannedAttempts,
});
const comparison = compareGateCalibrationReports(report, otherVerifiedReport);
```

`replayGateCalibration` resolves immutable gate, suite, rubric, evaluator, target, report,
trial and grade references, verifies their dependency closure and re-adjudicates report
bytes against independent bindings. Disposable runtime history is not needed. The
canonical raw-report blob is the callback's report JSON; it is not a native execution
trace. Actual client trace/receipt references must be supplied separately through
`artifact_refs`. Supplied evaluator revisions and adapter/source metadata do not prove
which native provider or code revision executed.

[`projectGateCalibration`](gates/report.ts) performs no I/O and requires verified replay
output. Its default inventory is the verified replay manifest. Optional `requested`
inventory is explicitly `caller_declared`, validates the canonical identity/case bindings
and rejects duplicates, unknown cases, extraneous grades or mismatched bindings. Suite
cases outside that inventory are unrequested cases, not missing attempts. Reserved
material receives no grade. The projection assesses `semantic_components`; full gate
acceptance remains `not_assessed` because runtime enforcement and other components
are outside these records.

Only valid, complete accepted/rejected outcomes with reviewed expected labels enter
TP/FP/TN/FN counts. False acceptance is `FP / (FP + TN)` and false rejection is
`FN / (TP + FN)`; a zero denominator yields `null`. Insufficient evidence, invalid
reports, errors, incomplete, unattempted and missing outcomes each retain the total
requested-attempt denominator. Unreviewed labels are separately counted. Criterion
matches/mismatches, including correct abstentions, describe expected-state agreement;
they are not binary accuracy. Repeat summaries compare valid binary outcome signatures
(acceptance and criterion states), retain abstentions and other outcomes separately,
and show distinct cases plus extra requested attempts. Repeated outputs do not supply
new independent task evidence. Timing, usage and cost remain explicitly unknown.

Complete `client_reported` provider/model/revision/known-context tuples group reported
configurations. Cross-configuration disagreement describes differing binary signatures
on shared cases; within-configuration instability can contribute to it. These groups
are not reviewer instances. Reviewer disagreement remains unavailable because the
contract carries no instance IDs or independently verified native identities. Omitted
revisions/context stay unknown; requested evaluator metadata and `identity.client`
are never substituted for observations.

`compareGateCalibrationReports` permits comparison only for identical gate, suite,
rubric and evaluator/configuration references plus identical selected case/target
coverage. It returns explicit incompatible binding names, without pooling records.
Compatibility alone establishes neither independent judgments nor model quality. A
future matched pilot must freeze both presentation templates in one experiment
configuration up front, selecting the treatment by canonical `arm` identity; changing
configuration between arms makes those reports incompatible. Software controls do
not establish live client integration, human calibration, native provider identity,
promotion eligibility or hosted CI success.

## Reviewed promotion evidence receipts

[`createGatePromotionReceipt`](gates/promotion.ts) derives the report again from an
archived calibration invocation and verifies that `report_ref` contains those exact
canonical JSON bytes. It takes an explicit reviewed disposition (`accepted`, `rejected`
or `inconclusive`), a frozen policy reference, reviewer evidence and destination/rollback
references. Each destination and rollback descriptor names the same gate ID as the
invocation. Optional `requested` inventory retains caller-declared missing attempts in
the recomputed report. This API records the supplied review decision; it does not
interpret opaque policy bytes or establish numerical threshold compliance. The frozen
pilot policy separately rejects critical false acceptance. Agent-only pilot evidence
cannot produce accepted promotion eligibility.

The resulting detached canonical `kind:"promotion"` record binds invocation, exact
gate/suite/rubric/evaluator pins, selected target coverage, report, policy, review,
destination and rollback evidence. Publish it explicitly with `archive.putRecord`.
The factory verifies the complete dependency graph before producing the receipt;
it does not write the receipt or change a resource.

Reviewer kind (`human` or `agent`), reviewer ID and review authority are supplied
claims with `authority:"caller_declared"`. An accepted request with an agent reviewer
or unknown human calibration has effective disposition `inconclusive`; its requested
disposition remains recorded. Explicit rejection remains rejected when human status
is unknown. A known human-calibration state means the suite supplied its required
human receipts, not that this package authenticated a person or observed their review.
A model PASS alone supplies no review authority and cannot create an eligible receipt.

`replayGatePromotionReceipt(archive, receiptRef, currentBinding)` resolves the full
receipt graph, replays calibration, recomputes the report and rechecks the stored
binding/disposition. `currentBinding` requires current `pins`, `selected_target_coverage`,
`policy_ref`, `destination` and `rollback`; none default to the receipt's old values.
A changed revision, selected target, policy, destination or rollback makes applicability
`stale`, with the changed binding names returned separately from the recorded decision.
Current references are structurally checked; the receipt's actual archived evidence
is resolved. This does not prove that a current external destination exists or was written.

A matching accepted receipt reports a `reviewed_candidate` under caller-declared
authority. Every result carries `automatic_promotion:false`, including accepted records.
Actual create/update/rollback stays with separately authorized `resource_manager`
operations and their existing confirmation/versioning rules. This API adds no promotion
verb, mutation capability, authenticated operator identity or native provider proof.
Missing or corrupt archive evidence throws; it does not yield a successful placeholder.

## Records and references

`createArchiveRecord` creates a detached, recursively frozen envelope.
`parseArchiveRecord` requires explicit usage/cost states and verifies the canonical body
digest. Missing factory measurements become `unknown`, with a reason; known zero remains
`known`. Trial and grade records bind the native seven-part identity, including each
retry's `attempt_id`. Generic JSON payloads remain owned by their domain-specific callers.

References distinguish blobs from records. Blob digests hash exact bytes; record digests
hash the canonical envelope body excluding `record_id`. Record references include their
kind. A blob's `media_type` is a caller annotation, not an independently verified content
classification. Lossy JSON, malformed controls/digests, and `__proto__` object keys are
refused; the last restriction preserves the shared canonical encoder's identity boundary.

## Private storage and replay

Choose an operator-owned private root outside Git and pass it to
`EvaluationArchive.open(root)`. There is no default path and no `state.db` dependency.
Keep raw native traces and authentication/session material out of Git.

| Method                      | Result                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `putBlob(bytes, mediaType)` | Publish exact bytes and return a blob reference                              |
| `getBlob(ref)`              | Read detached bytes and verify their digest                                  |
| `putRecord(record)`         | Resolve declared dependencies, then publish the canonical envelope           |
| `getRecord(ref)`            | Read a frozen envelope and verify its body digest, kind, and canonical bytes |
| `resolveClosure(refs)`      | Read and verify the entire declared reference graph without publishing       |

Before publishing a record, the archive resolves its top-level references, provenance
references, and known usage/cost source references. Missing or corrupt dependencies
refuse publication. `getRecord` validates the envelope itself; reading one envelope does
not recursively validate its dependency closure. Explicit `resolveClosure` follows record
references, provenance references and known usage/cost sources at every level, deduplicates
visited references and refuses missing or corrupt dependencies. Calibration and promotion
replay use this shared archive authority.

The flat layout is `blobs/<64-hex-digest>` and `records/<64-hex-digest>.json`. Roots and
archive directories require mode `0700`, final files require `0600`, and ownership is
checked where POSIX UID APIs are available. Existing broader permissions are refused;
caller paths are not chmodded. Newly created directories/files receive private modes.

Publication writes and fsyncs a unique exclusive temporary, creates a hard link without
overwriting the final path, fsyncs the directory, and cleans up the temporary. Identical
existing content is validated and reused. Corrupt finals are refused and preserved;
orphan temporaries do not count as publications.

This backend requires POSIX modes, hard links, and directory fsync; Windows is explicitly
refused. The controls were run on Node24/Linux. They cover concurrency, tampering,
truncation, partial finals, symlinks, traversal, permission refusal, and replay after
deleting unrelated disposable runtime state. Power-loss recovery has not been
fault-injected. Path checks and `O_NOFOLLOW` reject observed symlinks, but Node's
path-based filesystem API provides no guarantee against an adversarial same-user
directory swap inside an operator-owned root.
