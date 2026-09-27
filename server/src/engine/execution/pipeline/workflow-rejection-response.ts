// @lifecycle canonical - The one client render of addressed command rejections, shared by the stages that refuse.
import type { WorkflowRejection } from '#modules/workflow-ir/types.js';
import type { ToolResponse } from '#shared/types/index.js';

/**
 * Turn typed rejections into the addressed client response every refusing stage sets.
 *
 * Every line names the offending node or edge and the rule violated, because acceptance clause
 * (b) is "actionable", and a client that has to guess WHICH node failed fixes its submission one
 * error per round trip — the failure mode the rejection vocabulary exists to remove. One render
 * for every stage that refuses a command (04 for its shape and targets, 11 for a target a resume
 * can no longer reach, R65), so a client parses one shape whichever stage answered.
 */
export function buildWorkflowRejectionResponse(
  rejections: readonly WorkflowRejection[]
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
  return {
    content: [
      {
        type: 'text',
        text: [
          `❌ Workflow rejected — ${rejections.length} problem${rejections.length === 1 ? '' : 's'} found. Nothing was executed and no run was created.`,
          '',
          ...lines,
        ].join('\n'),
      },
    ],
    isError: true,
  };
}
