// @lifecycle canonical - Projects a run's live node list onto the step prompts the renderer walks.
//
// P4 row 3.4 (DEV-T3-7). Chain rendering used to index the PARSE-TIME step list by the run's
// current ordinal (`steps[currentStep - 1]`, clamped with `Math.min`). Both halves of that break
// the moment the node list is mutated:
//
//  - after an insertion, ordinal N no longer names parse step N, so every node past the insertion
//    rendered the prompt one ordinal early (footer "Progress 2/3" correct, BODY wrong prompt);
//  - the `Math.min(currentStep, steps.length)` clamp made the run's last real node unreachable,
//    because the run's ordinal space is longer than the parse-time array.
//
// The fix is to stop deriving identity from position: the RUN's node list is the render order,
// and each node's own `promptId` is what renders. `parsedCommand.steps` stays what it always was
// — the parse-time record used to mint nodes and to carry per-step authoring data (args,
// convertedPrompt, inlineGateIds, delegation, gate instructions) — and is now looked up BY NODE
// ID rather than by position.

import type { ChainNode } from '#shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '#shared/types/chain-session.js';
import type { ChainStepPrompt } from './types.js';

/**
 * The render order for one call: one entry per node of the run, plus the index the run stands at.
 */
export interface NodeRenderPlan {
  /** One step per node, in run order. Ordinals (`stepNumber`) are node ordinals. */
  readonly steps: ChainStepPrompt[];
  /** 0-based index into {@link steps} of the node the run is standing at. */
  readonly currentIndex: number;
  /**
   * True when the plan came from the run's node list; false when it fell back to the parse-time
   * array (no nodes, or a chain parsed before node ids were minted). Diagnostics only.
   */
  readonly nodeDriven: boolean;
}

export interface NodeRenderPlanInput {
  /** The run's live node list, in order. Empty for callers with no run. */
  readonly nodes: readonly ChainNode[];
  /** The parse-time step list — authoring data, never the render order. */
  readonly parseSteps: readonly ChainStepPrompt[];
  /** The node the run is standing at, per the store. */
  readonly currentNodeId: string | null | undefined;
  /** The run's ordinal, used only when the node list cannot answer (legacy/no-run paths). */
  readonly fallbackOrdinal: number;
  /** The run's unknowns ledger, used to recover an inserted node's investigation arguments. */
  readonly ledger?: readonly UnknownLedgerEntry[] | undefined;
}

/**
 * Build the render order for one chain call.
 *
 * Resolution per node, in order:
 *  1. the parse step whose `nodeId` equals this node's id — the normal case, and the ONLY case
 *     for an unmutated run, which is why a linear chain renders byte-identically (the very same
 *     step objects come back, in the same order, with the same ordinals);
 *  2. nothing matched and no parse step carries a node id at all → positional pairing, exactly
 *     what the old `steps[ordinal - 1]` did. A chain parsed before minting (P3 D10 keeps
 *     `nodeId` optional) must not lose its args and converted prompts;
 *  3. otherwise → a step synthesized from the NODE. This is the inserted-investigation case: its
 *     `promptId` is by construction absent from `parsedCommand.steps`, which is the whole point
 *     of the mutation.
 *
 * `stepNumber` is always the NODE ordinal, not the parse-time ordinal. Step results are stored
 * against the node ordinal (`ChainSessionStore.persistStepResult` computes `ordinalOf` on the
 * live list), and the footer's progress is derived from the same list, so any other numbering
 * would put the renderer's `{{previous_step_output}}` lookup and the client's footer on two
 * different scales.
 *
 * Skipped nodes stay IN the plan. They are retired, not deleted: their rows keep their ordinals,
 * the footer counts them, and `advanceStep` simply never lands on one — so a skipped node is
 * unreachable as `currentIndex` rather than absent from the array. Removing them here would put
 * the rendered ordinal and the footer's ordinal back on different scales, which is the defect
 * this module exists to remove.
 *
 * Pure: no I/O, no mutation of any input. Parse steps are returned by reference when their
 * ordinal already matches, so mutations other stages made on them (notably
 * `metadata.gateInstructions`, written by gate enhancement) travel through untouched.
 */
export function planNodeDrivenRender(input: NodeRenderPlanInput): NodeRenderPlan {
  const { nodes, parseSteps, currentNodeId, fallbackOrdinal, ledger } = input;

  if (nodes.length === 0) {
    return {
      steps: [...parseSteps],
      currentIndex: clampIndex(fallbackOrdinal - 1, parseSteps.length),
      nodeDriven: false,
    };
  }

  const byNodeId = new Map<string, ChainStepPrompt>();
  for (const step of parseSteps) {
    if (typeof step.nodeId === 'string' && step.nodeId.length > 0 && !byNodeId.has(step.nodeId)) {
      byNodeId.set(step.nodeId, step);
    }
  }
  const positional = byNodeId.size === 0;

  const steps = nodes.map((node, index) =>
    resolveStepForNode(node, index, byNodeId, positional ? parseSteps : undefined, ledger)
  );

  const currentIndex =
    typeof currentNodeId === 'string' ? nodes.findIndex((node) => node.id === currentNodeId) : -1;

  return {
    steps,
    currentIndex:
      currentIndex === -1 ? clampIndex(fallbackOrdinal - 1, nodes.length) : currentIndex,
    nodeDriven: !positional,
  };
}

/** One node's step: matched by id, paired positionally on legacy input, or synthesized. */
function resolveStepForNode(
  node: ChainNode,
  index: number,
  byNodeId: ReadonlyMap<string, ChainStepPrompt>,
  positionalSteps: readonly ChainStepPrompt[] | undefined,
  ledger: readonly UnknownLedgerEntry[] | undefined
): ChainStepPrompt {
  const ordinal = index + 1;

  const matched = byNodeId.get(node.id) ?? positionalSteps?.[index];
  if (matched !== undefined) {
    return matched.stepNumber === ordinal ? matched : { ...matched, stepNumber: ordinal };
  }

  return synthesizeStep(node, ordinal, ledger);
}

/**
 * A step for a node with no parse-time counterpart — an INSERTION or a caller-contributed
 * remainder node.
 *
 * The two kinds get their step from different places, and that difference is the design:
 *
 *  - an INSERTED investigation node's arguments are REBUILT from the ledger entry that motivated
 *    it. The statement already lives there, and storing a second copy on the node would make two
 *    that nothing keeps in step. The argument NAMES are the `investigate_unknown` resource's
 *    (`unknown_id`, `statement`), the only insertion kind v1 mints; a future insertion kind gets
 *    its own branch keyed on something the node carries, not a silent widening of these two;
 *  - a REMAINDER node's arguments and `==>` delegation were AUTHORED by the caller and exist
 *    nowhere else, so the node carries them (row A.5) and this is where they land on the step.
 *    Before A.5 they were validated, accepted and dropped here, and an appended step rendered
 *    with no arguments and no isolation however it was spelled.
 *
 * The insertion's rebuilt arguments win on the merge. They can only collide when a contributed
 * node also declares `unknown_id`/`statement`, and on an inserted node the ledger is the source
 * of record for both.
 *
 * `delegated` is set from the node's DECLARATION alone. `subagentModel` is deliberately not
 * consulted: stage 06's `markDelegatedStepPrompts` is the producer of the runtime flag for every
 * parse-time step, and a second producer reading a second field is how one flag comes to mean two
 * things. `RemainderProcessor` refuses `subagentModel` on a contributed node for the same reason.
 */
function synthesizeStep(
  node: ChainNode,
  ordinal: number,
  ledger: readonly UnknownLedgerEntry[] | undefined
): ChainStepPrompt {
  const args: Record<string, unknown> = { ...(node.args ?? {}) };
  const unknownId = node.originUnknownId;

  if (unknownId !== undefined && node.origin !== 'remainder') {
    args['unknown_id'] = unknownId;
    const entry = ledger?.find((candidate) => candidate.id === unknownId);
    const statement = entry?.statement ?? stripInvestigationPrefix(node.stepName);
    if (statement.length > 0) {
      args['statement'] = statement;
    }
  }

  return {
    stepNumber: ordinal,
    nodeId: node.id,
    promptId: node.promptId,
    args,
    ...(node.delegated === true ? { delegated: true } : {}),
  };
}

/**
 * Last-resort statement recovery from the node's own step name.
 *
 * `16-response-capture-stage.buildInvestigationStepName` writes `Investigate: <statement>`,
 * truncated. Used only when the ledger entry is gone (a resolved unknown is kept, so this is the
 * cold-load-of-a-pruned-ledger case) — a truncated statement renders better than none.
 */
function stripInvestigationPrefix(stepName: string): string {
  const marker = 'Investigate: ';
  return stepName.startsWith(marker) ? stepName.slice(marker.length) : stepName;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  return index >= length ? length - 1 : index;
}
