// @lifecycle canonical - Pure deterministic linearization of Workflow IR edges into a total order.
/**
 * Workflow IR linearizer.
 *
 * Edges are dependency constraints, not control flow (see `types.ts`). This module turns them
 * into the total order the runtime already speaks — `chain_run_nodes.position`.
 *
 * LINEARIZATION RULE (the doc statement, verbatim, is `docs/reference/workflow-ir.md`):
 *
 *   Kahn's algorithm over the dependency edges, where the ready set is drained in DECLARATION
 *   ORDER — at every step the runnable node that appears earliest in `nodes[]` is emitted next.
 *   Declaration order is a total order on the nodes, so the tiebreak is total, so the algorithm
 *   is a function: one IR has exactly one linearization. Two nodes can never "tie".
 *
 * WHY THERE IS NO `ambiguous-order` REJECTION. The plan (§Interfaces, OQ-P6-2) authored one, on
 * the reasoning that a silently-chosen order is a run the client did not author. That reasoning
 * holds against a tiebreak the client cannot predict — a hash order, an insertion order, a
 * stable sort over an unstated key. It does not hold here: the tiebreak IS the client's own
 * declaration order, so the chosen order is the one the client wrote, reordered only where its
 * own edges demanded. There is consequently no input on which this function could emit
 * `ambiguous-order`, and a reason with no producer is a vocabulary entry that can only mislead
 * the reader of the enum.
 *
 * The property that replaces it is stronger and testable: with no edges at all, the output is
 * `nodes[]` unchanged. A client that wants a specific order can simply write it.
 *
 * Pure: no I/O, no logging, no injected collaborators.
 */

import type { WorkflowEdge, WorkflowRejection } from './node-schema.js';

/**
 * What linearization needs of a node: an identity, and nothing else.
 *
 * Narrower than `WorkflowNode` on purpose. `modules/prompts/prompt-schema.ts` calls this to order
 * a YAML chain, whose steps are `ChainStep`s rather than IR nodes, and importing `types.js` here
 * would pull that file's tracked type-only cycle with `shared/types/execution.ts` into
 * `cli-shared`'s import graph — where the isolation gate requires zero violations.
 */
export type LinearizableNode = { readonly id: string };

/** Discriminated linearization result. Cycles are the only failure this function can produce. */
export type LinearizationResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly rejections: readonly WorkflowRejection[] };

/**
 * Linearize `nodes` under `edges`.
 *
 * PRECONDITION: edge endpoints exist and node ids are unique. `validateWorkflowIR` establishes
 * both before calling, and reports `edge-endpoint-missing` / `duplicate-node-id` itself — this
 * function silently ignores an edge naming an unknown node rather than duplicating that
 * reporting, because two producers for one reason is how rejection text drifts.
 *
 * @returns the total order, or a `cycle` rejection naming every node that could not be placed.
 */
export function linearize(
  nodes: readonly LinearizableNode[],
  edges: readonly WorkflowEdge[] = []
): LinearizationResult {
  const declarationIndex = new Map<string, number>();
  nodes.forEach((node, index) => declarationIndex.set(node.id, index));

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    dependents.set(node.id, []);
  }

  for (const edge of edges) {
    // Endpoints the validator already rejected, and self-edges, are skipped here. A self-edge is
    // a one-node cycle; leaving its in-degree unsatisfied is what makes it surface as `cycle`
    // below rather than as a silently-dropped constraint.
    if (!declarationIndex.has(edge.from) || !declarationIndex.has(edge.to)) {
      continue;
    }
    dependents.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // The ready set stays sorted by declaration index, which is the whole of the tiebreak. A plain
  // array + resort is used rather than a heap: `maxNodes` is 32, so the constant factor of a
  // priority queue would cost more reading than it saves running.
  const ready = nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: string[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0));
    const next = ready.shift();
    if (next === undefined) break;
    order.push(next);

    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  if (order.length !== nodes.length) {
    const placed = new Set(order);
    const stuck = nodes.filter((node) => !placed.has(node.id)).map((node) => node.id);
    return {
      ok: false,
      rejections: [
        {
          reason: 'cycle',
          ...(stuck[0] !== undefined ? { nodeId: stuck[0] } : {}),
          detail: `Workflow edges form a cycle: ${stuck.join(', ')} cannot be ordered because each depends on another node in the set`,
        },
      ],
    };
  }

  return { ok: true, order };
}
