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
