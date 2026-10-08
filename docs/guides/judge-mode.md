# How to Route a Gate Review to a Judge

Use judge mode to ask your client to review a chain step in a separate reviewer context.
The client invokes the reviewer; Claude Prompts supplies the review instructions and
validates the submitted result. A requested route or model hint does not prove which
provider, model, revision, or context the client actually used.

Separating review from generation can make a different perspective available. It does
not establish objectivity or remove self-evaluation bias by itself. Calibrate the review
against independent expected outcomes before making quality or cost claims.

## Prerequisites

- A chain step with a gate requiring review. Initial gate guidance on a single prompt
  remains advisory; see the [Gates Guide](./gates.md).
- A client capable of invoking the intended reviewer with the supplied public context.
- For semantic review, a server that accepts the authored criterion and supplies a
  frozen review binding. Check the current [tool contract](../reference/mcp-tools.md#gate-verdict-formats);
  parsing a criterion in isolation does not establish live runtime support.

## Steps

1. **Declare the requested route.** Add this configuration fragment to the gate:

   ```yaml
   evaluation:
     mode: judge
     model: model-id
     strict: true
   ```

   `mode: judge` requests a separate reviewer; `mode: self` requests client
   self-review. `model` is an optional hint that the client must resolve.
   `strict: true` requests failure-first framing; `false` requests balanced
   assessment. Framing is a review instruction, not evidence that a judgment is
   correct. For authored fields and configuration defaults, use the
   [Gate Configuration Reference](../reference/gate-configuration.md).

2. **Give the reviewer the supplied public review context.** Use the judge section
   returned with the pending chain review. It includes the target output, public
   criteria, gate identity, framing, and verdict instructions. Semantic reviews also
   include the bounded rubric and a binding when capture has made one available.
   Keep private calibration cases, expected labels, and sibling targets out of this
   context.

   The review instructions ask for a separate context without generation history.
   The client's execution determines whether that separation occurred. Do not report
   a requested `judge` route as verified isolation.

3. **Capture the target before submitting a semantic report.** When no binding has
   been issued, first submit `user_response` alone, without a semantic report. After
   receiving the server-issued binding, prefer a report-only submission. Copy its
   `gate_id`, `node_id`, `attempt_id`, `definition_digest`, and `target_digest`
   unchanged and review the frozen target and gate definition.

   If a semantic report resends the body, it must contain the identical canonical
   whole `user_response.trim()` bytes. A replacement or subset is a different
   target. To replace the output, submit FAIL against the old target, receive the
   renewed server attempt, capture the new output in a separate call, then submit
   a fresh bound report. These capture rules apply to semantic reports; ordinary
   legacy review behavior remains unchanged.

   Missing or mismatched definitions and bindings leave semantic acceptance
   unavailable. Do not invent pins or substitute a bare PASS. Use the
   [complete submission contract](../reference/mcp-tools.md#gate-verdict-formats)
   for the request shape.

4. **Submit one structured observation per public semantic criterion.** Put the
   `SemanticEvaluationReport` in the matching `gate_verdict.per_gate[].evaluation`
   entry. It contains the binding and observations keyed by `criterion_id`.

   States are `met`, `unmet`, `insufficient_evidence`, or
   `not_applicable`. For `met`/`unmet`, supply a value in the declared result
   domain. Cite evidence from the bound target using half-open UTF-16 `start` and
   `end` offsets, its `target_digest`, and an optional exact quote. Meet the
   evidence minimum. Use `not_applicable` only when the criterion permits it.

   The server derives contract acceptance from the bound observations and combines
   it with applicable tool-check results. A client PASS cannot replace missing
   observations, insufficient evidence, or a failed tool check. The
   [submission reference](../reference/mcp-tools.md#gate-verdict-formats) owns the
   complete request shape.

5. **Record provenance at the strength the evidence supports.** Reviewer metadata
   may carry `provider`, `model`, `revision`, and `context`
   (`self`, `separate_pass`, `isolated_judge`, or `unknown`).
   Its provenance is `client_reported` or `unknown`; these fields do not
   authenticate a reviewer or establish native provider identity. Keep unavailable
   fields unknown. A binary or configuration digest does not supply an observed
   model revision.

## Verification

Check that the submitted report uses the advertised binding and criterion IDs, and
that its evidence points into the exact captured target. Inspect the recorded
structured results through [execution history](../reference/mcp-tools.md); reading
those results does not establish the reviewer's identity or calibration accuracy.

For ordinary legacy reviews, the advertised `GATE_REVIEW: PASS|FAIL - reason`
format remains available. For semantic criteria, a bare verdict line and a hook PASS
are self-review or stop attestations, not semantic grades. An exported skill's
static rubric likewise supplies no runtime binding. Without bound MCP context,
semantic contract acceptance is unavailable.

Keep tool verification, semantic observations, and reminder attestations distinct.
A semantic acceptance result assesses the declared evidence contract; it is not a
general claim about the output's quality.

## Calibrate Before Reusing a Review

Use the [semantic gate calibration guide](./semantic-gate-calibration.md) to compare
reviews against independently reviewed cases, retain errors and abstentions, and bind
a reviewed disposition to exact revisions. Select reviewer models against that
evidence and your client budget; this guide establishes no savings or model-ranking
claim.

## See Also

- [Gates Guide](./gates.md)
- [Gate Configuration Reference](../reference/gate-configuration.md)
- [MCP Tool Reference](../reference/mcp-tools.md)
- [Optional Evaluation Package](../../evaluations/README.md)
