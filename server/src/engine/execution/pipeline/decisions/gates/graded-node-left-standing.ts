// @lifecycle canonical - The node a call's verdict graded and left standing under a held advance.
/**
 * The node this call's verdict graded and the run STILL stands on once the advance it decided was
 * applied: `applyDeferredAdvance` held that advance (a pending `:: verify:` check, an unknown
 * interrupt), so the verdict spent on the node is the verdict the node gets for this answer. PURE.
 *
 * A review opened on that node now would ask for the verdict the call has just given, and the
 * check that holds the step would then leave the step to it ("left-to-review"). Measured
 * 2026-10-21 on a one-call `user_response` + `gate_verdict` over `:: verify:"npm test"`: the run
 * answered on that call and asked again on the next. `undefined` when the call decided no advance
 * or the run moved off the node (the review of the step it moved ONTO is then a new step's).
 */
export function gradedNodeLeftStanding(
  result: { readonly deferredAdvance?: { readonly nodeId: string } | undefined },
  standingNodeId: string | null | undefined
): string | undefined {
  const advance = result.deferredAdvance;
  return advance !== undefined && advance.nodeId === standingNodeId ? advance.nodeId : undefined;
}
