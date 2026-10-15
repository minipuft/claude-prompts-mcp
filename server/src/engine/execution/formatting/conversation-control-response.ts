// @lifecycle canonical - Conversation-control packet and reply text for pause, resume, paused refusal and custody.
/**
 * What `pause`, `resume`, a call refused on a paused run and a paused claim answer (T2.3): text
 * and `structuredContent.conversation_control`, both rendered from one run snapshot so they cannot
 * disagree. The owed obligation is read off the snapshot, never executed. The recovery credential
 * appears only in a direct pause or custody reply's text; the packet picks its fields explicitly.
 * ResponseAssembler's `format*` methods are the callers. PURE.
 */

import { HANDOFF_RESULT_HEADING } from '../delegation/handoff-contract.js';
import { isUnknownInterruptPending } from '../pipeline/decisions/index.js';

import type { GateReview, GateReviewKind, GateReviewPhase } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ConversationControlInspection,
  ConversationControlResult,
  ConversationPause,
  ExactControlScope,
} from '#shared/types/chain-session.js';
import type { ToolResponse } from '#shared/types/index.js';

import { unreportedDetachedNodeIds } from '#shared/types/chain-execution.js';
import { currentOrdinal, ordinalOf, totalOf } from '#shared/utils/node-order.js';

/** What an exhausted review accepts, in the words every reply holding one uses. */
export const EXHAUSTED_REVIEW_CHOICE =
  'The retry budget is spent. Choose a review `gate_action`: `retry`, or `skip` to accept the answer already given.';

/** The run as a control reply reads it: the durable inspection's view, credential stripped. */
export type ControlRunSnapshot = ConversationControlInspection['session'];

/** What the run still owes beneath a conversation pause, one entry per held node. */
export interface ConversationObligation {
  readonly kind:
    | 'step'
    | 'review'
    | 'blocking-unknown'
    | 'exhausted-retry'
    | 'shell-verification'
    | 'detached-report';
  readonly nodeId: string;
  /** 1-based position of `nodeId` in the run. */
  readonly step: number;
  /** Present on `review`: what opened it and where it stands. */
  readonly review?: { readonly kind: GateReviewKind; readonly phase: GateReviewPhase };
}

/** The exact run a control reply names. */
export interface ConversationControlRun {
  /** The run UUID (`sessionId`). */
  readonly runId: string;
  readonly chainId: string;
  readonly scope: ExactControlScope;
  readonly currentNodeId: string | null;
  /** `current` is `total` once the run is past its last node (the reply text's "N of N"). */
  readonly step: { readonly current: number; readonly total: number };
  readonly pause: ConversationPause | null;
  readonly obligations: readonly ConversationObligation[];
}

type ControlRefusalReason = Extract<ConversationControlResult, { outcome: 'refused' }>['reason'];

/** `structuredContent.conversation_control`. Never carries the recovery credential. */
export interface ConversationControlPacket {
  readonly kind: 'conversation_control';
  readonly outcome: 'paused' | 'already-paused' | 'resumed' | 'claimed' | 'refused';
  readonly refusal?: {
    readonly reason: ControlRefusalReason | 'conversation-paused';
    readonly retryable: boolean;
  };
  /** Absent only when the store could not identify the run (busy, unknown id, other scope). */
  readonly run?: ConversationControlRun;
}

const CONTROL_REFUSALS: Record<ControlRefusalReason, string> = {
  'unknown-session': 'no nonterminal run with that id exists in this workspace.',
  'scope-mismatch': 'the run belongs to another workspace or continuity scope.',
  'ownership-lost': 'another server claimed the run, so this one can no longer change it.',
  'run-terminal': 'the run already ended (completed, failed or cancelled).',
  'recovery-credential-missing':
    'the paused run carries no recovery credential, so it cannot be controlled safely; abort it.',
  busy: 'work on the run had not settled when the control arrived. Retry the same call; nothing changed.',
};

function obligationOfReview(review: GateReview): ConversationObligation['kind'] {
  if (isUnknownInterruptPending(review)) return 'blocking-unknown';
  return review.phase === 'exhausted' ? 'exhausted-retry' : 'review';
}

/**
 * Every obligation the snapshot holds: open reviews, a pending shell verification, unreported
 * detached nodes (`unreportedDetachedNodeIds`, the one derivation), and the current step itself
 * when nothing else is held on it. PURE.
 */
export function deriveObligations(session: ControlRunSnapshot): ConversationObligation[] {
  const { nodes, currentNodeId, stepStates } = session.state;
  const at = (kind: ConversationObligation['kind'], nodeId: string): ConversationObligation => ({
    kind,
    nodeId,
    step: ordinalOf(nodes, nodeId),
  });
  const owed: ConversationObligation[] = Object.values(session.reviews ?? {}).map((review) => ({
    ...at(obligationOfReview(review), review.nodeId),
    review: { kind: review.kind, phase: review.phase },
  }));
  const held = (nodeId: string): boolean => owed.some((entry) => entry.nodeId === nodeId);
  const verifying = session.pendingShellVerification?.nodeId;
  if (verifying !== undefined && !held(verifying)) owed.push(at('shell-verification', verifying));
  for (const nodeId of unreportedDetachedNodeIds(nodes, stepStates)) {
    if (!held(nodeId)) owed.push(at('detached-report', nodeId));
  }
  if (currentNodeId !== null && !held(currentNodeId)) owed.push(at('step', currentNodeId));
  return owed;
}

/** The packet's run identity and position, picked field by field off the snapshot. PURE. */
function projectRun(session: ControlRunSnapshot, scope: ExactControlScope): ConversationControlRun {
  const { nodes, currentNodeId } = session.state;
  const total = totalOf(nodes);
  return {
    runId: session.sessionId,
    chainId: session.chainId,
    scope: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      continuityScopeId: scope.continuityScopeId,
    },
    currentNodeId,
    step: { current: currentNodeId === null ? total : currentOrdinal(nodes, currentNodeId), total },
    pause: session.conversationPause ?? null,
    obligations: deriveObligations(session),
  };
}

function describePosition(run: ConversationControlRun): string {
  const { current, total } = run.step;
  return run.currentNodeId === null
    ? `past its last step (${total} of ${total}), still held open`
    : `step ${current} of ${total}`;
}

const trailer = (nodeId: string): string =>
  `ending with its \`${HANDOFF_RESULT_HEADING}\` trailer \`node: ${nodeId}\``;

function describeReview(owed: ConversationObligation, call: string): string {
  const kind = owed.review?.kind ?? 'gate';
  const detached = kind === 'detached' ? `, ${trailer(owed.nodeId)}` : '';
  const head = `the ${kind} review of step ${owed.step} (node \`${owed.nodeId}\`)`;
  return owed.review?.phase === 'awaiting-replacement'
    ? `${head} asks for a replacement answer: send it as \`user_response\` with ${call}${detached}.`
    : `${head} awaits a \`gate_verdict\`: send it with ${call}` +
        (detached === '' ? '.' : ` and \`user_response\`${detached}.`);
}

/** The move that answers one obligation — named, never a generic "continue". PURE. */
function describeObligation(chainId: string, owed: ConversationObligation): string {
  const call = `\`chain_id:"${chainId}"\``;
  const at = `step ${owed.step} (node \`${owed.nodeId}\`)`;
  switch (owed.kind) {
    case 'step':
      return `${at} still needs its answer: send it as \`user_response\` with ${call}.`;
    case 'review':
      return describeReview(owed, call);
    case 'blocking-unknown':
      return (
        `the blocking-unknown hold is still pending at ${at}: send \`gate_action:"resume"\` ` +
        'again to issue its investigation step, or `gate_action:"accept_alternative"` with a `remainder`.'
      );
    case 'exhausted-retry':
      return `the review of ${at} has spent its retries. ${EXHAUSTED_REVIEW_CHOICE}`;
    case 'shell-verification':
      return (
        `the shell verification of ${at} has not passed: fix what it checks, then send ` +
        `\`user_response\` with ${call}, or \`gate_action:"retry"\` or \`"skip"\`.`
      );
    case 'detached-report':
      return (
        `detached ${at} has not reported: when its worker finishes, send its result as ` +
        `\`user_response\` with ${call}, ${trailer(owed.nodeId)}.`
      );
  }
}

function describeOwed(label: string, run: ConversationControlRun): string {
  if (run.obligations.length === 0) {
    return `\n\n${label}: no step, review, verification or report.`;
  }
  const lines = run.obligations.map((owed) => `- ${describeObligation(run.chainId, owed)}`);
  return `\n\n${label}:\n${lines.join('\n')}`;
}

const resumeOrAbort = (chainId: string): string =>
  `Resume it with \`prompt_engine(chain_id:"${chainId}", gate_action:"resume")\`, or end it ` +
  'with `gate_action:"abort"`.';

const reply = (
  text: string,
  isError: boolean,
  packet?: ConversationControlPacket
): ToolResponse => ({
  content: [{ type: 'text' as const, text }],
  isError,
  ...(packet !== undefined ? { structuredContent: { conversation_control: packet } } : {}),
});

const refused = (
  reason: NonNullable<ConversationControlPacket['refusal']>['reason'],
  run: ConversationControlRun | undefined
): ConversationControlPacket => ({
  kind: 'conversation_control',
  outcome: 'refused',
  refusal: { reason, retryable: reason === 'busy' },
  ...(run !== undefined ? { run } : {}),
});

const OWED_AFTER_RESUME = 'Still owed once resumed';

/** A pause, resume or control refusal; the recovery token appears in a pause reply only. PURE. */
export function renderConversationControl(
  chainId: string,
  result: ConversationControlResult
): ToolResponse {
  if (result.outcome === 'refused') {
    const { inspection, reason } = result;
    const header = reason === 'busy' ? '⏳ **Control Busy**' : '⚠️ **Control Not Applied**';
    const run = inspection === null ? undefined : projectRun(inspection.session, inspection.scope);
    return reply(
      `${header}: \`${chainId}\` — ${CONTROL_REFUSALS[reason]}`,
      true,
      refused(reason, run)
    );
  }
  const run = projectRun(result.inspection.session, result.inspection.scope);
  const packet: ConversationControlPacket = {
    kind: 'conversation_control',
    outcome: result.outcome,
    run,
  };
  if (result.outcome === 'resumed') {
    return reply(
      `▶️ **Workflow Resumed**: \`${run.chainId}\` at ${describePosition(run)}. Nothing was ` +
        'captured, graded or advanced.' +
        describeOwed('Owed now, in a separate call', run),
      false,
      packet
    );
  }
  return reply(
    `⏸️ **Workflow Paused**: \`${run.chainId}\` at ${describePosition(run)}. Discuss the step ` +
      `with the user; nothing advances until you resume.\n\n${resumeOrAbort(run.chainId)}` +
      describeOwed(OWED_AFTER_RESUME, run) +
      `\n\nRecovery token: \`${result.token}\` — claim the paused run from another client ` +
      'with `prompt_engine(claim_token:"…")`.',
    false,
    packet
  );
}

/** A workflow call on a paused run, refused before any change. PURE. */
export function renderPausedRefusal(
  session: ControlRunSnapshot,
  scope: ExactControlScope,
  restart: boolean
): ToolResponse {
  const run = projectRun(session, scope);
  return reply(
    `⏸️ **Workflow Paused**: \`${run.chainId}\` is paused for conversation at ` +
      `${describePosition(run)}. ` +
      (restart ? '`force_restart` cannot replace a paused run. ' : '') +
      `This call was refused and nothing changed.\n\n${resumeOrAbort(run.chainId)} ` +
      'Inspect it with `system_control(action:"session", operation:"inspect")`.' +
      describeOwed(OWED_AFTER_RESUME, run),
    true,
    refused('conversation-paused', run)
  );
}

/** A claimed paused run stops at custody: the successor token in the text, the pause kept. PURE. */
export function renderPausedCustody(session: ChainSession, scope: ExactControlScope): ToolResponse {
  const run = projectRun(session, scope);
  return reply(
    `🔑 **Paused Run Claimed**: \`${run.chainId}\` is now held here, still paused at ` +
      `${describePosition(run)}. Nothing was resumed, rendered or advanced.\n\n` +
      resumeOrAbort(run.chainId) +
      describeOwed(OWED_AFTER_RESUME, run) +
      `\n\nRecovery token: \`${session.handoffToken ?? 'none'}\` (single-use).`,
    false,
    { kind: 'conversation_control', outcome: 'claimed', run }
  );
}

/** A paused mint that did not apply (busy, or no credential to rotate). PURE. */
export const renderPausedMintRefusal = (chainId: string): ToolResponse =>
  reply(
    `⏳ **Handoff Not Minted**: \`${chainId}\` is paused for conversation and its recovery ` +
      'credential was not rotated. Nothing changed. Retry the same call, or resume the run ' +
      `first.\n\n${resumeOrAbort(chainId)}`,
    true
  );
