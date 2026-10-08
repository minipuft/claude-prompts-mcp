# How to Calibrate a Semantic Gate

Compare semantic reviews against independently reviewed cases and retain the exact
evidence needed to replay a report or reconsider a promotion decision.

## Prerequisites

- Use the opt-in repository-local [evaluation package](../../evaluations/README.md#setup-and-checks)
  with Node24 and its pinned server toolchain. Gate modules require the documented
  TypeScript loader; native core tests are a separate surface.
- Keep the caller-owned archive and private suite outside served resource directories,
  disposable runtime directories, and Git. Keep authentication material and raw native
  traces private.
- Use a caller-supplied client adapter. The package does not start model sessions or
  choose a provider. An adapter's report JSON is not a native execution trace.

## Steps

1. **Author a public rubric and freeze it.** Use the existing MCP resource workflow
   and [Gate Configuration Reference](../reference/gate-configuration.md). Give each
   criterion a stable ID, target, evidence minimum, bounded result, and acceptance
   predicate. For example, this standalone criterion describes a public requirement:

   ```yaml
   type: semantic_evaluation
   id: requirement-coverage
   target:
     kind: step_output
   question: Does the output address the public requirement?
   evidence_requirements:
     min_items: 1
   result:
     kind: boolean
   acceptance:
     kind: equals
     value: true
   allow_not_applicable: false
   ```

   Standalone schema parsing checks this contract; it does not prove enabled MCP
   authoring or runtime review. Check the current [MCP reference](../reference/mcp-tools.md).
   The public gate may carry an opaque `calibration_suite_id`. That association does
   not resolve a private path or run a suite. Freeze the gate snapshot and public
   rubric as archive references before invoking calibration.

2. **Prepare an independently versioned private suite.** Bind its gate ID,
   definition digest, criterion IDs, targets, and expected criterion states to the
   frozen rubric. Include reviewed positive, negative, valid-alternative, boundary,
   and insufficient-evidence families. Declare each case's exposure as
   `development`, `runtime_anchor`, or `reserved` and retain label-review evidence.
   Record human calibration as known or unknown according to the supplied receipts.

   `gateSuiteReadiness` checks structural pilot readiness, not model accuracy or
   human identity. `projectGateSuiteCase` selects one case's target reference and
   public rubric; it excludes expected labels and sibling cases and refuses reserved
   cases. Keep reserved material out of ordinary adapter/reviewer context.

3. **Run an explicit frozen invocation.** Supply `runGateCalibration` with the
   archive, private suite, public rubric, gate snapshot reference, evaluator
   revision/configuration, declared attempt inventory, and adapter callback. Reuse
   the native seven-part identity, including a distinct `attempt_id` for each retry.
   The invocation retains immutable attempt starts and subsequent outcomes.

   The adapter receives the selected target, public rubric, and bound review
   identity. Return a completed report, an explicit incomplete outcome, or an error.
   Attach actual client trace/receipt references separately through `artifact_refs`.
   Requested configuration and supplied adapter revisions do not prove what the
   native client executed.

4. **Replay before projecting a report.** The following flow uses caller-prepared
   inputs; it contains no private suite contents or provider implementation:

   ```typescript
   const run = await runGateCalibration(invocationOptions);
   const replay = await replayGateCalibration(
     invocationOptions.archive,
     run.invocation_ref,
   );
   const report = projectGateCalibration(replay);
   ```

   Replay resolves the archived gate, suite, rubric, evaluator, targets, reports,
   trials, and grades, verifies their dependency closure, and re-adjudicates report
   bytes. Missing or corrupt evidence refuses replay. `getRecord` alone verifies
   its envelope; explicit `resolveClosure` verifies the reference graph. See
   [private storage and replay](../../evaluations/README.md#private-storage-and-replay).

5. **Read the denominators and limitations.** The report defaults to the verified
   replay manifest. An optional planned `requested` inventory is caller-declared
   and makes absent planned attempts visible. Unrequested suite cases are not
   missing attempts. Reserved cases receive no ordinary calibration grade.

   Reviewed, valid binary outcomes enter the confusion counts. False acceptance is
   `FP / (FP + TN)`; false rejection is `FN / (TP + FN)`. A zero denominator is
   `null`. Errors, invalid reports, incomplete, unattempted, missing, and
   insufficient-evidence outcomes retain their requested-attempt denominator.
   Repeated attempts retain distinct-case counts; they are not independent tasks.

   The scope is `semantic_components`, with full gate acceptance `not_assessed`.
   Configuration disagreement compares client-reported configuration outcomes;
   reviewer disagreement, timing, usage, and cost remain explicitly unknown.
   Changed gate, suite, rubric, evaluator, target coverage, or configuration bindings
   can make report comparisons incompatible. Use the
   [report reference](../../evaluations/README.md#explicit-calibration-invocation-and-reports)
   for the complete fields and comparison rules.

6. **Record a reviewed disposition without applying it automatically.** Freeze the
   report, policy, reviewer evidence, destination, and rollback references, then call
   `createGatePromotionReceipt`. Publish the returned receipt explicitly with
   `archive.putRecord`.

   `accepted`, `rejected`, and `inconclusive` are caller-declared review decisions.
   An accepted request with an agent reviewer or unknown human calibration has
   effective disposition `inconclusive`; the requested disposition remains recorded.
   Explicit rejection remains rejected. Supplied human receipts do not authenticate
   a person, and the receipt factory does not interpret opaque policy bytes as
   numerical threshold compliance.

   `replayGatePromotionReceipt` requires current bindings and reports stale evidence
   when relevant revisions, selected targets, policy, destination, or rollback change.
   Every receipt has `automatic_promotion:false`. Actual resource changes remain
   separately authorized MCP operations. See
   [reviewed promotion receipts](../../evaluations/README.md#reviewed-promotion-evidence-receipts).

## Measured scope: software controls and native pilot

At measured source revision `9ad69854a1857e5a638978d5479b14f3d945cb47`, 33 accepted
software controls comprised 25 built-server controls (18 lifecycle, two authoring,
five history/BYPASS) and eight source-carrier controls across the transport inventory.
Both STDIO and HTTP were exercised; the history/BYPASS controls include a seeded
facet. Dropping report forwarding caused two controls to fail; restoring it passed.
These controls establish software paths and custody, not reviewer truth. Fresh-process
handoff proof covers rolling handoff, not dead-owner restart recovery.

The separate agent-reviewed native pilot made 11 calls: one matched C8 coding task
and ten reviews of five development targets in prose and structured presentation
frames. Both frames used identical criteria, output and evidence contracts,
configuration and bindings. Each call had a 300-second cap, zero retries, concurrency one and a
two-child limit; no children were spawned. Each frame's report inventory contains
six slots: five attempted development cases and one unattempted reserved case.

| Observation                  | Measured result                                                                                                              | Interpretation                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Reviews, each frame          | Three accepted, one rejected, one insufficient-evidence; reserved slot unattempted                                           | Six inventory slots, five native reviews, four binary-eligible outcomes      |
| Binary confusion, each frame | TP=3, TN=1, FP=0, FN=0; false acceptance 0/1, false rejection 0/3                                                            | Observed agent-label agreement on this sample                                |
| Criterion states, each frame | Both criteria matched 5/5 reviewed states, including one correct abstention each                                             | Insufficient evidence remains distinct from binary acceptance                |
| Native failures              | Invalid reports, errors, timeouts and policy violations: zero                                                                | No observed presentation advantage; paired targets are not independent tasks |
| C8 elapsed time              | Retained baseline 226.629 seconds; new run 103.633 seconds                                                                   | One matched coding comparison; no causal or savings conclusion               |
| C8 software checks           | Artifact, types and regression passed; both seeded defects were detected                                                     | Eligible for review, not full accepted quality                               |
| C8 static diagnostics        | Baseline artifact → new artifact: lint 16→15, cognitive complexity 5→5, cyclomatic complexity 11→10; original fixture 14/2/6 | Diagnostics do not replace manual quality review                             |

The coding comparison retained task, framework, model/effort, caps, helpers and
toolchain bindings, including Codex `0.159.2` through a private read-only two-file
overlay after host-version drift. MCP, plugins and hooks were disabled for coding;
this result supplies no live-gate workflow benefit. Human calibration, completed
manual quality review, model revision and whole-task billing remain unknown. The
canonical calibration reports also retain unknown usage, timing, cost and reviewer
instance identity, even though separate native collectors retained execution
receipts. These results establish neither general accuracy nor quality superiority.

Canonical archive replay verified the dependency closure. A requested `accepted`
promotion had effective disposition `inconclusive`, with `automatic_promotion:false`.
Its current bindings still matched after deleting the disposable candidate database,
WAL and SHM; public resource bytes and archive evidence remained intact. No resource
promotion mutation occurred, and native collector evidence does not establish a
native MCP-session join.

Operators retaining this pilot can inspect `evidence/native-measurement.json` and
`evidence/native-disposition.json` under their private evaluation root. These local
receipts and their private dependencies are not distributed with the guide. The
immutable record digests are:

- Measurement: `sha256:8e8448785b337c35cb5cd92a694767d40d3797eb829229e83102562ebe1249aa`
- Disposition: `sha256:0e008bd3fd56843d410ac39e39747c712e0818ce0b8f9730c1cd364ba279af2f`
- Replay: `sha256:3e6be0cda29c169c9027b0f7aed0f982c8ab80c6b9a9d5600480c9ec886744ed`

## Verification

Retain the invocation and receipt references and confirm that replay resolves their
complete evidence graphs. Keep requested routing separate from observed provenance;
missing provider, model revision, human-review, or billing evidence stays unknown.
Offline software controls establish contract and archive behavior. Native reliability,
cost, savings, and promotion eligibility require their own measured evidence.

Operational execution history is ephemeral. Archive replay uses the selected immutable
store instead; see [gate history and calibration evidence](../architecture/sqlite-persistence.md#gate-history-and-calibration-evidence).
For review submission and attestation boundaries, use the
[Judge Mode Guide](./judge-mode.md).
