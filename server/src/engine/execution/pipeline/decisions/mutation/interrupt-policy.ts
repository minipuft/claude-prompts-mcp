// @lifecycle canonical - Sole owner of the mid-chain blocking-unknown interrupt decision.

import type { ChainNode, PendingGateReview } from '#shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '#shared/types/chain-session.js';
import type {
  ChainInterrupt,
  DecideInterruptInput,
  InterruptNodeSummary,
  InterruptResolutionAction,
} from './types.js';

import { currentOrdinal, ordinalOf } from '#shared/utils/node-order.js';

import { UNKNOWN_INTERRUPT_GATE_ID } from './types.js';

/**
 * Whether a pending review is the synthetic one a hard-paused blocking unknown raises (D-2).
 *
 * The single reader of {@link UNKNOWN_INTERRUPT_GATE_ID} for every consumer that has to tell a
 * server-minted interrupt hold apart from an ordinary authored gate review: stage 16 (does this
 * run already hold?), `GateVerdictProcessor` (may `resume`/`accept_alternative` mean anything on
 * THIS review?), and `ResponseAssembler` (render verbs, not a `gate_verdict` template).
 *
 * A function rather than three inline `gateIds.includes(...)` checks, because the three answers
 * must never disagree: a run the assembler renders as resumable that the verdict processor
 * refuses to resume is an unanswerable pause, and that is exactly what three copies of one
 * membership test drift into.
 */
export function isUnknownInterruptPending(review: PendingGateReview | undefined): boolean {
  return review?.gateIds?.includes(UNKNOWN_INTERRUPT_GATE_ID) === true;
}

/**
 * Narrow `McpToolRequest.gate_action`'s five-member union to the interrupt half (OQ-4).
 *
 * The one place the two vocabularies are told apart. Everything downstream of it takes either
 * an {@link InterruptResolutionAction} or a `GateAction`, never the union — so no handler can be
 * reached with a verb it has no branch for and silently do nothing.
 */
export function isInterruptResolutionAction(
  action: string | undefined
): action is InterruptResolutionAction {
  return action === 'resume' || action === 'accept_alternative';
}

/**
 * Decide whether the run owes its caller a structured interrupt, and what that interrupt says.
 *
 * Pure: no I/O, no mutation of `input`, no pipeline/context dependency — the sibling posture of
 * `decideMutation`, `resolveEnforcementMode` and `InjectionDecisionService.decide`. The caller
 * (stage 16, row 2.1) puts the returned {@link ChainInterrupt} on `context` and, when `paused`,
 * raises the synthetic `UNKNOWN_INTERRUPT_GATE_ID` review; this function never touches storage,
 * never reads `mcpRequest`, and never renders text.
 *
 * The interrupt is a function of the ledger's OPEN state, not of a delta. A blocking unknown
 * that stays open therefore keeps re-raising the interrupt on every later step, which is the
 * intended reading of "the run is blocked" — the caller told the server it could not proceed,
 * and nothing has said otherwise yet. Resolving the unknown (`unknown_resolved`, either
 * resolution) is what clears it, because a resolved entry is no longer open.
 *
 * Returns `undefined` — not a `{kind:'none'}` shape — when no blocking unknown is open. There is
 * exactly one rejection cause here, so a named-reason union would carry no information the
 * absence does not (contrast {@link decideMutation}, whose four causes are genuinely different
 * outcomes a caller and a test need to tell apart).
 */
export function decideInterrupt(input: DecideInterruptInput): ChainInterrupt | undefined {
  const unknown = selectTriggeringUnknown(input.ledger);
  if (unknown === undefined) {
    return undefined;
  }

  return {
    reason: 'blocking_unknown',
    unknownId: unknown.id,
    statement: unknown.statement,
    affectedStepIds: collectAffectedStepIds(input),
    remainingNodes: summarizeRemainingNodes(input),
    paused: input.pauseOnBlocking === true,
  };
}

/**
 * The open blocking entry the interrupt is ABOUT.
 *
 * The most recently discovered one wins (`discoveredAtStep`, ties broken by later ledger
 * position, which is discovery order within a step's batch). Ledger order alone would make an
 * older still-open unknown outrank the discovery that just arrived, so a run holding two
 * blocking unknowns would keep reporting the stale one while the fresh one — the reason THIS
 * step stopped — never appeared in a payload.
 *
 * `blocking` is read off the LEDGER entry, not off an observation: `computeUnknownLedger` has
 * already resolved the `?? false` default, and restating it here would be a second copy of a
 * transition rule this module does not own.
 */
function selectTriggeringUnknown(
  ledger: readonly UnknownLedgerEntry[]
): UnknownLedgerEntry | undefined {
  let chosen: UnknownLedgerEntry | undefined;
  for (const entry of ledger) {
    if (entry.state !== 'active' || entry.blocking !== true) {
      continue;
    }
    if (chosen === undefined || entry.discoveredAtStep >= chosen.discoveredAtStep) {
      chosen = entry;
    }
  }
  return chosen;
}

/**
 * OQ-2: `affectedStepIds` comes from DECLARED `target_step_id` links and nothing else.
 *
 * Collected across every open blocking entry, not only the triggering one — a run holding two
 * blocking unknowns is affected in both their declared places, and a caller authoring a
 * replacement remainder needs the whole set. Each link is kept only when it names a node that
 * (a) exists in the run and (b) is STRICTLY ahead of the current node: a step already executed
 * or currently rendered cannot be re-planned, the same boundary `decideSkip` and
 * `markNodeSkipped` draw (OQ-P4-2). Results are deduplicated and returned in run order, so the
 * list reads as a slice of the plan rather than as ledger order.
 */
function collectAffectedStepIds(input: DecideInterruptInput): readonly string[] {
  const here = currentOrdinal(input.nodes, input.currentNodeId);
  const byOrdinal = new Map<number, string>();

  for (const entry of input.ledger) {
    if (entry.state !== 'active' || entry.blocking !== true) {
      continue;
    }
    const targetStepId = entry.targetStepId;
    if (targetStepId === undefined) {
      continue;
    }
    const ordinal = ordinalOf(input.nodes, targetStepId);
    if (ordinal === -1 || ordinal <= here) {
      continue;
    }
    byOrdinal.set(ordinal, targetStepId);
  }

  return [...byOrdinal.keys()].sort((a, b) => a - b).map((ordinal) => byOrdinal.get(ordinal) ?? '');
}

/**
 * The plan the caller is being invited to replace: every node strictly after the current one.
 *
 * `currentOrdinal` is 1-based, so it is already the array index of the first node after the
 * current one — and it folds `currentNodeId === null` into `nodes.length + 1`, so a run that has
 * advanced past its terminal node yields an empty remainder through the same slice rather than a
 * separate null branch.
 */
function summarizeRemainingNodes(input: DecideInterruptInput): readonly InterruptNodeSummary[] {
  const here = currentOrdinal(input.nodes, input.currentNodeId);
  return input.nodes.slice(here).map(summarizeNode);
}

function summarizeNode(node: ChainNode): InterruptNodeSummary {
  return { id: node.id, promptId: node.promptId, stepName: node.stepName };
}
