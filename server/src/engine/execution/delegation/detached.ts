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

import type {
  GateReviewKind,
  GateReviewPhase,
  StepMetadata,
} from '#shared/types/chain-execution.js';
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
  /**
   * Where its late result's gate review stands (row 4.8): the `phase` of the detached review
   * `reviews[nodeId]` holds. Absent when none is open — a PASS deletes the review.
   */
  readonly review?: GateReviewPhase;
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
  session: {
    readonly state: {
      readonly nodes: readonly { readonly id: string }[];
      readonly stepStates?: ReadonlyMap<string, StepMetadata>;
    };
    readonly reviews?: Readonly<
      Record<string, { readonly kind: GateReviewKind; readonly phase: GateReviewPhase }>
    >;
  }
): DetachedNodeFacts[] {
  const run = session.state;
  const owed = new Set(unreportedDetachedNodeIds(run.nodes, run.stepStates));
  return (steps ?? [])
    .filter((step) => step.await === 'run')
    .flatMap((step) => {
      const nodeId = step.nodeId ?? run.nodes[step.stepNumber - 1]?.id;
      if (nodeId === undefined) return [];
      const spawned = run.stepStates?.get(nodeId)?.spawnedAt !== undefined;
      const review = session.reviews?.[nodeId];
      return [
        {
          token: handoffNodeToken(step),
          nodeId,
          stepNumber: step.stepNumber,
          spawned,
          reported: spawned && !owed.has(nodeId),
          ...(review?.kind === 'detached' ? { review: review.phase } : {}),
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
  /**
   * The same resume, but a gate review is holding the run: the review's own verdict path decides
   * whether the run advances, exactly as it does for any step. The detached node is neither
   * passed here nor checked for a worker reply it is not waiting for.
   */
  | { readonly kind: 'review-pending'; readonly node: DetachedNodeFacts }
  /**
   * The reply's trailer names a spawned detached node that is owed its result — or whose review
   * FAILed and asked for a replacement (`replaces`, R10.2), which records over the first result.
   */
  | { readonly kind: 'report'; readonly node: DetachedNodeFacts; readonly replaces?: boolean }
  /** A `gate_verdict` whose trailer names a detached node whose review awaits one (R8). */
  | { readonly kind: 'review-verdict'; readonly node: DetachedNodeFacts }
  /** A `gate_action` whose trailer names a detached node whose review exhausted its retries. */
  | { readonly kind: 'review-action'; readonly node: DetachedNodeFacts }
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
 *   way to move on (`continue-past`) — or, while a gate review holds the run, the review's verdict
 *   path decides the advance (`review-pending`); a non-empty one under `required` is refused with both
 *   options, because it is either a worker result missing its trailer or a note the run would
 *   otherwise capture as the step's output. Under `advisory` it is the ordinary capture.
 */
export function resolveDetachedReport(input: {
  readonly reply: string;
  readonly mode: HandoffEvidenceMode;
  /** A step gate review is holding the run (a non-detached entry of `ChainSession.reviews`). */
  readonly reviewPending?: boolean;
  /** This call carries a `gate_verdict` / a `gate_action` (row 4.8 routes them by trailer). */
  readonly submits?: { readonly verdict: boolean; readonly action: boolean };
  readonly current: CurrentNodeFacts | null;
  readonly detachedNodes: readonly DetachedNodeFacts[];
}): DetachedReportDecision {
  const { reply, current, detachedNodes } = input;
  if (detachedNodes.length === 0) {
    return { kind: 'not-detached' };
  }

  const named = parseHandoffTrailer(reply).node;
  if (named !== null) {
    return routeNamedToken(named, current, detachedNodes, input.submits);
  }

  if (current === null) {
    return { kind: 'refuse', message: describeHeldRun(detachedNodes) };
  }

  const standing = current.detached
    ? detachedNodes.find((node) => node.token === current.token)
    : undefined;
  if (standing?.spawned !== true) {
    return { kind: 'not-detached' };
  }
  if (reply.length === 0) {
    // A standing node that already reported (its result arrived before the parent moved on) is
    // passed the same way; the stage keeps its recorded output rather than a placeholder.
    return input.reviewPending === true
      ? { kind: 'review-pending', node: standing }
      : { kind: 'continue-past', node: standing };
  }
  if (standing.reported) {
    return { kind: 'not-detached' };
  }
  return input.mode === 'required'
    ? { kind: 'refuse', message: describeUntaggedDetachedReply(standing) }
    : { kind: 'not-detached' };
}

function routeNamedToken(
  named: string,
  current: CurrentNodeFacts | null,
  detachedNodes: readonly DetachedNodeFacts[],
  submits: { readonly verdict: boolean; readonly action: boolean } | undefined
): DetachedReportDecision {
  const node = detachedNodes.find((candidate) => candidate.token === named);
  // The current node's own token is the ordinary capture — unless that node is detached: then
  // its result (arriving before the parent moved on) is a report like any late one (row 4.8).
  if (current !== null && named === current.token && (node === undefined || !current.detached)) {
    return { kind: 'not-detached' };
  }
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
  if (!node.reported) {
    return { kind: 'report', node };
  }
  return routeReportedNode(node, submits ?? { verdict: false, action: false });
}

/**
 * A trailer naming a detached node that already reported: its gate review decides (row 4.8).
 * The review's phase is the state machine — a verdict answers `awaiting-verdict`, a replacement
 * answers `awaiting-replacement`, a `gate_action` answers `exhausted`; anything else is refused
 * by name, naming the call that phase is waiting for. No review at all is the Tier 4 refusal.
 */
function routeReportedNode(
  node: DetachedNodeFacts,
  submits: { readonly verdict: boolean; readonly action: boolean }
): DetachedReportDecision {
  const label = `Detached node ${node.token} (step ${node.stepNumber})`;
  if (node.review === undefined) {
    return {
      kind: 'refuse',
      message: submits.verdict
        ? `❌ No gate review is open for ${label}: its result is recorded and was not reviewed, ` +
          `so there is no verdict to give. Nothing was recorded.`
        : `❌ ${label} already reported; its result ` +
          `is recorded and is not replaced. Nothing was recorded, and this reply was not applied ` +
          `to the step the run stands on.`,
    };
  }
  if (node.review === 'awaiting-verdict' && submits.verdict) {
    return { kind: 'review-verdict', node };
  }
  if (node.review === 'exhausted' && submits.action) {
    return { kind: 'review-action', node };
  }
  if (node.review === 'awaiting-replacement' && !submits.verdict && !submits.action) {
    return { kind: 'report', node, replaces: true };
  }
  const waitingFor: Record<GateReviewPhase, string> = {
    'awaiting-verdict': 'a gate_verdict, with user_response ending in this trailer',
    'awaiting-replacement':
      "the worker's replacement result as user_response (no gate_verdict), ending in this trailer",
    exhausted: 'gate_action "retry" or "skip" with this trailer, or cancel: true',
  };
  return {
    kind: 'refuse',
    message:
      `❌ The gate review of ${label} is waiting for ${waitingFor[node.review]}:\n` +
      `${trailerBlock(node.token)}\nNothing was recorded.`,
  };
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
  const underReview = detachedNodes.filter((node) => node.reported && node.review !== undefined);
  const first = owed[0];
  const named = (nodes: readonly DetachedNodeFacts[]): string =>
    nodes.map((node) => `${node.token} (step ${node.stepNumber})`).join(', ');
  const lines = [
    owed.length > 0
      ? `⏸ Every step has run, but the run stays open until its detached node(s) report: ${named(owed)}.`
      : '⏸ Every step has run, but the run stays open until its detached review(s) are answered.',
  ];
  if (underReview.length > 0) {
    lines.push(
      `Gate review still open on reported detached node(s): ${named(underReview)} — ` +
        'answer each with gate_verdict and user_response ending in its HANDOFF RESULT trailer.'
    );
  }
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
    /** The gate review this report opened (row 4.8), rendered by {@link describeDetachedReview}. */
    readonly review?: string;
    /** This report replaced a result whose review FAILed (R10.2). */
    readonly replaced?: boolean;
  }
): string {
  const recorded = after.replaced === true ? 'replaces its first result' : 'is recorded';
  const reported = `✓ Detached node ${node.token} (step ${node.stepNumber}) reported; its result ${recorded} on that step.`;
  const head = after.review !== undefined ? `${reported}\n\n${after.review}` : reported;
  return `${head}\n\n${describeRunPosition(after)}`;
}

/**
 * Where the run stands after a detached node's report or review resolved: completed, held past
 * its end, or unmoved. Shared by every reply a detached node's result gets.
 */
function describeRunPosition(after: {
  readonly runCompleted: boolean;
  readonly held: boolean;
  readonly detachedNodes: readonly DetachedNodeFacts[];
}): string {
  if (after.runCompleted) {
    return '✅ Chain complete — every step, including the detached ones, has reported.';
  }
  if (after.held) {
    return describeHeldRun(after.detachedNodes);
  }
  return 'The run is where it was: resume with chain_id and the output of the step it stands on.';
}

/**
 * The gate review a detached node's late result opened (row 4.8): which node, which attempt, the
 * verdict template, and the exact call that answers it. The template is the one the current-step
 * review renders (`buildStructuredVerdictTemplate`), handed in so this module stays pure.
 */
export function describeDetachedReview(
  node: DetachedNodeFacts,
  review: {
    readonly chainId: string;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly verdictTemplate: string;
  }
): string {
  return [
    '---',
    `**Gate Review Required — detached node ${node.token} (step ${node.stepNumber})** ` +
      `(attempt ${review.attempt}/${review.maxAttempts})`,
    '',
    'Review the result the worker reported above against the gates, then submit — the ' +
      "user_response is only the trailer, which routes the verdict to that node's review:",
    '',
    '```',
    `chain_id="${review.chainId}"`,
    `gate_verdict=${review.verdictTemplate}`,
    `user_response="${HANDOFF_RESULT_HEADING}\nnode: ${node.token}"`,
    '```',
    '',
    'Shell and script checks of these gates run against that recorded result when the verdict ' +
      'arrives. Set `"overall": "FAIL"` to ask the worker for a replacement result.',
  ].join('\n');
}

/** What a verdict (or `gate_action`) on a detached node's review answers. */
export function describeDetachedReviewOutcome(
  node: DetachedNodeFacts,
  outcome: {
    readonly result: 'passed' | 'failed' | 'exhausted' | 'retry' | 'skipped';
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly runCompleted: boolean;
    readonly held: boolean;
    readonly detachedNodes: readonly DetachedNodeFacts[];
  }
): string {
  const label = `detached node ${node.token} (step ${node.stepNumber})`;
  const counter = `(attempt ${outcome.attempt}/${outcome.maxAttempts})`;
  const replace =
    'Re-run the worker; resume with its new result as user_response, ending with the same ' +
    `trailer — it replaces the first:\n${trailerBlock(node.token)}`;
  const heads: Record<typeof outcome.result, string> = {
    passed: `✓ Gate review of ${label} passed; its recorded result stands.`,
    skipped: `✓ Gate review of ${label} skipped by gate_action; its recorded result stands.`,
    failed: `✗ Gate review of ${label} failed ${counter}. ${replace}`,
    retry: `↻ Retry count of ${label}'s gate review reset. ${replace}`,
    exhausted:
      `✗ Gate review of ${label} failed ${counter} — the retry limit is reached. Resume with ` +
      `gate_action "retry" (another replacement) or "skip" (accept the recorded result), with ` +
      `user_response ending in:\n${trailerBlock(node.token)}\nor stop the run with cancel: true.`,
  };
  return `${heads[outcome.result]}\n\n${describeRunPosition(outcome)}`;
}
