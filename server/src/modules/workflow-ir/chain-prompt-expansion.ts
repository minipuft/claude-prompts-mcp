// @lifecycle canonical - Sole in-place expansion of a Workflow IR node that names a chain prompt.
/**
 * A node naming a chain prompt → that prompt's projected steps, spliced into the IR in place
 * (ruling R40, rows P6.79/P6.80).
 *
 * Before this module an arrow-chain segment (`>>chain_prompt` followed by another segment) and a
 * submitted `workflow` node naming a chain prompt each compiled to ONE step whose prompt was the
 * chain prompt itself: the step rendered the chain's own template, carried no step gates, and
 * none of the declared steps ran. A bare `>>chain` and a `>>chain :: …` already ran the steps
 * through `projectChainPromptSteps` (R36). One prompt now means one thing in every source,
 * because every IR — minted by the arrow-chain builder or submitted by a client — is expanded by
 * this function at the entry of `compileWorkflowIR`, the one function both reach.
 *
 * THE EXPANSION, per node whose prompt declares `chainSteps`:
 *   - steps: `projectChainPromptSteps(prompt, node.args, lookup)` — the same projection the direct
 *     and single-symbolic paths call, with the node's args as the run args;
 *   - ids: `<node-id>-<step-node-id>` (`n1-a`, `x-b`), made unique against every id already in the
 *     IR. Kebab-case on purpose: `WORKFLOW_NODE_ID_PATTERN` and both `target_step_id` schemas
 *     accept kebab or `nK`, and a dotted `n1.a` would be refused by all three;
 *   - the node's own gates (`inlineGateIds`, `inlineGateCriteria`) are ADDED to every expanded
 *     step, and its declarations (`delegated`, `subagentModel`, `agentType`, `framework`,
 *     `retries`, `await`, `visibility`) override each step's — the node is the caller's
 *     statement about the whole segment, as R37 applies a command-level criterion to every step;
 *   - `inputMapping` lands on the first expanded step, `outputMapping` on the last, and edges into
 *     or out of the node re-attach to the first/last expanded step; the expanded steps are linked
 *     in declaration order. `order` is rewritten in place, so a validated order stays valid;
 *   - a run-level gate whose `target_step_id` names the node is retargeted to its LAST expanded
 *     step (R41): the node's id addresses "when this node is done". `lastStepOf` carries the same
 *     mapping for the request's `gates` channel, which is where a workflow's gates are read.
 *
 * Pure: the lookup is injected, nothing is logged, the input IR is not mutated.
 */

import type { ChainStepPrompt } from '#engine/execution/operators/types.js';
import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ExpandedWorkflow, WorkflowEdge, WorkflowIR, WorkflowNode } from './types.js';

import { projectChainPromptSteps } from '#engine/execution/parsers/chain-step-projection.js';
import { mintInsertionId } from '#shared/utils/node-order.js';

/**
 * Expand every node naming a chain prompt into the prompt's projected steps. An IR with no such
 * node is returned as given (same objects), so a submission of single prompts is unchanged.
 */
export function expandChainPromptNodes(
  ir: WorkflowIR,
  order: readonly string[],
  lookupPrompt: (promptId: string) => ConvertedPrompt | undefined
): ExpandedWorkflow {
  const taken = ir.nodes.map((node) => node.id);
  const expansions = new Map<string, WorkflowNode[]>();

  for (const node of ir.nodes) {
    const prompt = lookupPrompt(node.promptId);
    // An unregistered prompt is the compiler's error to raise, with its own message.
    const projection =
      prompt === undefined
        ? undefined
        : projectChainPromptSteps(prompt, { ...(node.args ?? {}) }, lookupPrompt);
    if (projection === undefined) continue;

    const expanded = projection.steps.map((step, index) => {
      const id = mintInsertionId(`${node.id}-${step.nodeId ?? `n${index + 1}`}`, taken);
      taken.push(id);
      return toExpandedNode(id, step, node, index, projection.steps.length);
    });
    expansions.set(node.id, expanded);
  }

  if (expansions.size === 0) {
    return { ir, order, lastStepOf: {}, stepsOf: {} };
  }

  const first = (id: string): string => expansions.get(id)?.[0]?.id ?? id;
  const last = (id: string): string => expansions.get(id)?.at(-1)?.id ?? id;
  const internalEdges: WorkflowEdge[] = [...expansions.values()].flatMap((nodes) =>
    nodes.slice(1).map((node, index) => ({ from: (nodes[index] as WorkflowNode).id, to: node.id }))
  );
  const edges: WorkflowEdge[] = [
    ...(ir.edges ?? []).map((edge) => ({ from: last(edge.from), to: first(edge.to) })),
    ...internalEdges,
  ];

  const lastStepOf = Object.fromEntries([...expansions.keys()].map((id) => [id, last(id)]));
  const stepsOf = Object.fromEntries(
    [...expansions].map(([id, nodes]) => [id, nodes.map((node) => node.id)])
  );

  return {
    ir: {
      ...ir,
      nodes: ir.nodes.flatMap((node) => expansions.get(node.id) ?? [node]),
      ...(edges.length > 0 ? { edges } : {}),
      ...(ir.gates !== undefined ? { gates: retargetGates(ir.gates, lastStepOf) } : {}),
    },
    order: order.flatMap((id) => expansions.get(id)?.map((node) => node.id) ?? [id]),
    lastStepOf,
    stepsOf,
  };
}

/**
 * Point every gate whose `target_step_id` names an expanded node at that node's last step.
 * A gate naming any other id, a bare gate id, and a gate with no target are returned as given;
 * a retargeted gate is a new object, so the caller's gates are never mutated.
 *
 * Generic over the element type because it has two callers with two vocabularies: the IR's
 * `gates` (`GateSpecification`) and stage 04's request `gates` channel (`unknown[]`, the client's
 * payload), which reaches it through `WorkflowIrPort.retargetGates` — `engine/` may not
 * value-import this module.
 */
export function retargetGates<Gate>(
  gates: readonly Gate[],
  lastStepOf: Readonly<Record<string, string>>
): Gate[] {
  return gates.map((gate) => {
    if (typeof gate !== 'object' || gate === null) return gate;
    const target = (gate as { target_step_id?: unknown }).target_step_id;
    const retarget = typeof target === 'string' ? lastStepOf[target] : undefined;
    return retarget === undefined ? gate : { ...gate, target_step_id: retarget };
  });
}

/** One projected step as an IR node, carrying the segment node's declarations. */
function toExpandedNode(
  id: string,
  step: ChainStepPrompt,
  segment: WorkflowNode,
  index: number,
  count: number
): WorkflowNode {
  const gateIds = union(step.inlineGateIds, segment.inlineGateIds);
  const criteria = union(step.inlineGateCriteria, segment.inlineGateCriteria);
  const inputMapping =
    index === 0 && segment.inputMapping !== undefined
      ? { ...step.inputMapping, ...segment.inputMapping }
      : step.inputMapping;
  const outputMapping =
    index === count - 1 && segment.outputMapping !== undefined
      ? { ...step.outputMapping, ...segment.outputMapping }
      : step.outputMapping;
  const subagentModel = segment.subagentModel ?? step.subagentModel;
  const agentType = segment.agentType ?? step.agentType;
  const framework = segment.framework ?? step.framework;
  const retries = segment.retries ?? step.retries;
  const delegated = segment.delegated ?? step.delegated;
  const awaitMode = segment.await ?? step.await;
  const visibility = segment.visibility ?? step.visibility;

  return {
    id,
    promptId: step.promptId,
    args: step.args,
    ...(inputMapping !== undefined ? { inputMapping } : {}),
    ...(outputMapping !== undefined ? { outputMapping } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(subagentModel !== undefined ? { subagentModel } : {}),
    ...(agentType !== undefined ? { agentType } : {}),
    ...(framework !== undefined ? { framework } : {}),
    ...(gateIds !== undefined ? { inlineGateIds: gateIds } : {}),
    ...(criteria !== undefined ? { inlineGateCriteria: criteria } : {}),
    ...(delegated !== undefined ? { delegated } : {}),
    ...(awaitMode !== undefined ? { await: awaitMode } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
  };
}

/** Order-preserving union; `undefined` only when neither side declared the list. */
function union(
  own: readonly string[] | undefined,
  added: readonly string[] | undefined
): string[] | undefined {
  if (own === undefined && added === undefined) return undefined;
  return [...new Set([...(own ?? []), ...(added ?? [])])];
}
