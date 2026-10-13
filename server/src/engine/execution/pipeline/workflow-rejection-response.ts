// @lifecycle canonical - The one client render of addressed command rejections, shared by the stages that refuse.
import type { WorkflowRejection } from '#modules/workflow-ir/types.js';
import type { ToolResponse } from '#shared/types/index.js';

/**
 * Turn typed rejections into the addressed client response every refusing stage sets.
 *
 * Every line names the offending node or edge and the rule violated, because acceptance clause
 * (b) is "actionable", and a client that has to guess WHICH node failed fixes its submission one
 * error per round trip — the failure mode the rejection vocabulary exists to remove. One render
 * for every stage that refuses a command (04 for its shape and targets; 05 for every refusal of
 * the call's own gates — an inline criterion or request gate that cannot register, a named or
 * request gate under a canonical id, a target a resume can no longer reach, a gate a switch
 * withholds; 11 for a gate withheld by the planner's default `%clean`), so a client parses one
 * shape whichever stage answered. "Nothing was executed" holds because every refusal but that
 * last lands before stage 08 runs a script tool.
 *
 * `resumedChainId` is the run a refused resume names, or `undefined` for a first call. It is
 * required so every refusing stage decides it: a refused resume leaves an existing run where it
 * stood, and "no run was created" would tell its client the run is gone (R143).
 */
export function buildWorkflowRejectionResponse(
  rejections: readonly WorkflowRejection[],
  resumedChainId: string | undefined
): ToolResponse {
  const lines = rejections.map((rejection) => {
    const address =
      rejection.edge !== undefined
        ? `edge ${rejection.edge.from} -> ${rejection.edge.to}`
        : rejection.nodeId !== undefined
          ? `node "${rejection.nodeId}"`
          : 'workflow';
    return `• [${rejection.reason}] ${address}: ${rejection.detail}`;
  });
  const outcome =
    resumedChainId === undefined
      ? 'no run was created.'
      : `run \`${resumedChainId}\` was not moved: its state is what it was before this call.`;
  return {
    content: [
      {
        type: 'text',
        text: [
          `❌ Workflow rejected — ${rejections.length} problem${rejections.length === 1 ? '' : 's'} found. Nothing was executed and ${outcome}`,
          '',
          ...lines,
        ].join('\n'),
      },
    ],
    isError: true,
  };
}
