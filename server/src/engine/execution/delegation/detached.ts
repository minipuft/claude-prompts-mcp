// @lifecycle canonical - Detached delegation: which node a resume reports for, and what a held run says.
/**
 * Detached delegation (`await: run`, delegation handoff contract Tier 4).
 *
 * A detached step's brief is rendered like any delegated step's, but the run does not wait for
 * its worker: the parent resumes with no `user_response` to move on, and the worker's result
 * arrives LATER, on whatever resume the parent sends when it finishes. The node token in that
 * result's `HANDOFF RESULT` trailer is the only router — {@link resolveDetachedReport} reads it
 * to decide which node a reply belongs to, so a late result lands on the node that produced it
 * and never on the step the run happens to be standing on.
 *
 * The run's side of the obligation (it may not COMPLETE while a spawned detached node is
 * unreported) lives in `ChainSessionStore.transitionRunStatus`; the one derivation of "owed" is
 * `unreportedDetachedNodeIds` in `shared/types/chain-execution.ts`, which
 * {@link collectDetachedNodeFacts} reads rather than restating.
 *
 * Pure functions over plain data — no pipeline imports, no state.
 */

import {
  HANDOFF_RESULT_HEADING,
  handoffNodeToken,
  parseHandoffTrailer,
} from './handoff-contract.js';

import type { StepMetadata } from '#shared/types/chain-execution.js';
import type { HandoffEvidenceMode } from './handoff-contract.js';

import { unreportedDetachedNodeIds } from '#shared/types/chain-execution.js';

/** One detached (`await: run`) node of a run, as the router needs it. */
export interface DetachedNodeFacts {
  /** The handoff token its brief printed (`handoffNodeToken`). */
  readonly token: string;
  readonly nodeId: string;
  readonly stepNumber: number;
  /** Its brief was rendered (`StepMetadata.spawnedAt`). */
  readonly spawned: boolean;
  /** It holds a real captured output. Only meaningful once `spawned`. */
  readonly reported: boolean;
}

/** The step fields {@link collectDetachedNodeFacts} reads, structurally. */
interface DetachedStepFacts {
  readonly stepNumber: number;
  readonly nodeId?: string;
  readonly await?: 'node' | 'run';
}

/**
 * The detached nodes of a run, with their lifecycle read off the run's node rows. PURE.
 *
 * The declaration comes from the parse-time steps (where every step declaration lives); the
 * lifecycle comes from the store. A step with no node id resolves by position, the same fallback
 * `handoffNodeToken` applies to its token.
 */
export function collectDetachedNodeFacts(
  steps: readonly DetachedStepFacts[] | undefined,
  run: {
    readonly nodes: readonly { readonly id: string }[];
    readonly stepStates?: ReadonlyMap<string, StepMetadata>;
  }
): DetachedNodeFacts[] {
  const owed = new Set(unreportedDetachedNodeIds(run.nodes, run.stepStates));
  return (steps ?? [])
    .filter((step) => step.await === 'run')
    .flatMap((step) => {
      const nodeId = step.nodeId ?? run.nodes[step.stepNumber - 1]?.id;
      if (nodeId === undefined) return [];
      const spawned = run.stepStates?.get(nodeId)?.spawnedAt !== undefined;
      return [
        {
          token: handoffNodeToken(step),
          nodeId,
          stepNumber: step.stepNumber,
          spawned,
          reported: spawned && !owed.has(nodeId),
        },
      ];
    });
}

/** The node a resume stands on, as the router needs it; `null` when the run is past its end. */
export interface CurrentNodeFacts {
  readonly token: string;
  readonly delegated: boolean;
  readonly detached: boolean;
}

/** What a resume means for a run's detached nodes. */
export type DetachedReportDecision =
  /** Nothing detached is involved — the ordinary resume path handles it, unchanged. */
  | { readonly kind: 'not-detached' }
  /** The run stands on a spawned detached node and the parent resumed without its result. */
  | { readonly kind: 'continue-past'; readonly node: DetachedNodeFacts }
  /** The reply's trailer names a spawned, unreported detached node other than the current one. */
  | { readonly kind: 'report'; readonly node: DetachedNodeFacts }
  /** Refused, naming the node the reply named (or the nodes the run is owed) and the fix. */
  | { readonly kind: 'refuse'; readonly message: string };

/**
 * Decide what a resume means for a run's detached nodes. PURE.
 *
 * - A run with no detached node → `not-detached`, always: a blocking chain's resume path is
 *   byte-for-byte what it was before detached delegation existed.
 * - A trailer naming the CURRENT node → `not-detached`: the ordinary capture takes it (for a
 *   detached current node that is its result arriving before the parent moved on).
 * - A trailer naming a detached node → `report` when it was spawned and has not reported;
 *   refused by name when it has already reported or was never spawned. Never applied to the
 *   current node.
 * - A trailer naming nothing detached → refused by name when the current node is not delegated
 *   (or the run is past its end); a delegated current node leaves it to the handoff-evidence
 *   check, whose `node-mismatch` refusal already names both tokens.
 * - No trailer at all, on a run past its last node → refused, naming every node still owed.
 * - No trailer, standing on a spawned, unreported detached node: an EMPTY reply is the documented
 *   way to move on (`continue-past`); a non-empty one under `required` is refused with both
 *   options, because it is either a worker result missing its trailer or a note the run would
 *   otherwise capture as the step's output. Under `advisory` it is the ordinary capture.
 */
export function resolveDetachedReport(input: {
  readonly reply: string;
  readonly mode: HandoffEvidenceMode;
  readonly current: CurrentNodeFacts | null;
  readonly detachedNodes: readonly DetachedNodeFacts[];
}): DetachedReportDecision {
  const { reply, current, detachedNodes } = input;
  if (detachedNodes.length === 0) {
    return { kind: 'not-detached' };
  }

  const named = parseHandoffTrailer(reply).node;
  if (named !== null) {
    return routeNamedToken(named, current, detachedNodes);
  }

  if (current === null) {
    return { kind: 'refuse', message: describeHeldRun(detachedNodes) };
  }

  const standing = current.detached
    ? detachedNodes.find((node) => node.token === current.token)
    : undefined;
  if (standing === undefined || !standing.spawned || standing.reported) {
    return { kind: 'not-detached' };
  }
  if (reply.length === 0) {
    return { kind: 'continue-past', node: standing };
  }
  return input.mode === 'required'
    ? { kind: 'refuse', message: describeUntaggedDetachedReply(standing) }
    : { kind: 'not-detached' };
}

function routeNamedToken(
  named: string,
  current: CurrentNodeFacts | null,
  detachedNodes: readonly DetachedNodeFacts[]
): DetachedReportDecision {
  if (current !== null && named === current.token) {
    return { kind: 'not-detached' };
  }
  const node = detachedNodes.find((candidate) => candidate.token === named);
  if (node === undefined) {
    return current?.delegated === true
      ? { kind: 'not-detached' }
      : { kind: 'refuse', message: describeUnknownToken(named, detachedNodes) };
  }
  if (!node.spawned) {
    return {
      kind: 'refuse',
      message:
        `❌ Detached node ${node.token} (step ${node.stepNumber}) has not been spawned yet — ` +
        `the run has not rendered its brief, so no worker can have produced this result. ` +
        `Nothing was recorded.`,
    };
  }
  if (node.reported) {
    return {
      kind: 'refuse',
      message:
        `❌ Detached node ${node.token} (step ${node.stepNumber}) already reported; its result ` +
        `is recorded and is not replaced. Nothing was recorded, and this reply was not applied ` +
        `to the step the run stands on.`,
    };
  }
  return { kind: 'report', node };
}

/** The copyable trailer a worker's reply must end with to report for `token`. */
function trailerBlock(token: string): string {
  return ['```', HANDOFF_RESULT_HEADING, `node: ${token}`, '```'].join('\n');
}

function describeOwed(detachedNodes: readonly DetachedNodeFacts[]): DetachedNodeFacts[] {
  return detachedNodes.filter((node) => node.spawned && !node.reported);
}

function describeUnknownToken(named: string, detachedNodes: readonly DetachedNodeFacts[]): string {
  const owed = describeOwed(detachedNodes);
  const owedLine =
    owed.length === 0
      ? 'No detached node of this run is waiting for a result.'
      : `Detached node(s) waiting for a result: ${owed.map((node) => node.token).join(', ')}.`;
  return (
    `❌ The reply's HANDOFF RESULT names node ${named}, which is no detached node of this run. ` +
    `Nothing was recorded, and the reply was not applied to the step the run stands on. ${owedLine}`
  );
}

function describeUntaggedDetachedReply(node: DetachedNodeFacts): string {
  return [
    `❌ Step ${node.stepNumber} (node ${node.token}) is detached: the run does not wait for its worker.`,
    'Resume with chain_id and NO user_response to move on now, or — if this is the worker’s ' +
      'result — end it with:',
    trailerBlock(node.token),
    'Nothing was recorded.',
  ].join('\n');
}

/**
 * What a run that has walked past its last node, but is still owed a detached result, says.
 * Deliberately avoids the completion wording hooks key on: the run is NOT finished.
 */
export function describeHeldRun(detachedNodes: readonly DetachedNodeFacts[]): string {
  const owed = describeOwed(detachedNodes);
  const first = owed[0];
  const lines = [
    `⏸ Every step has run, but the run stays open until its detached node(s) report: ` +
      owed.map((node) => `${node.token} (step ${node.stepNumber})`).join(', ') +
      '.',
  ];
  if (first !== undefined) {
    lines.push(
      'When a worker finishes, resume with chain_id and its result as user_response, ending with:',
      trailerBlock(first.token)
    );
    if (owed.length > 1) {
      lines.push('(one resume per node, each naming its own token)');
    }
  }
  lines.push('A worker that will never report: stop the run with cancel: true.');
  return lines.join('\n');
}

/** The acknowledgement a resume carrying a late detached result gets. */
export function describeLandedReport(
  node: DetachedNodeFacts,
  after: {
    /** The run is now `completed` — this was the last thing it was owed. */
    readonly runCompleted: boolean;
    /** The run is past its last node and still owed another detached result. */
    readonly held: boolean;
    /** The run's detached nodes as they stand AFTER this report landed. */
    readonly detachedNodes: readonly DetachedNodeFacts[];
  }
): string {
  const head = `✓ Detached node ${node.token} (step ${node.stepNumber}) reported; its result is recorded on that step.`;
  if (after.runCompleted) {
    return `${head}\n\n✅ Chain complete — every step, including the detached ones, has reported.`;
  }
  if (after.held) {
    return `${head}\n\n${describeHeldRun(after.detachedNodes)}`;
  }
  return `${head}\n\nThe run is where it was: resume with chain_id and the output of the step it stands on.`;
}
