// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { addressedReview } from '../../../gates/services/gate-verdict-processor.js';
import { UnknownObservationValidationError } from '../../capture/unknown-observation-processor.js';
import {
  collectDetachedNodeFacts,
  describeDetachedReview,
  describeDetachedReviewOutcome,
  describeLandedReport,
  resolveDetachedReport,
} from '../../delegation/detached.js';
import {
  HANDOFF_RESULT_HEADING,
  handoffNodeToken,
  parseHandoffTrailer,
  resolveHandoffEvidence,
  resolveHandoffEvidenceMode,
} from '../../delegation/handoff-contract.js';
import { buildStructuredVerdictTemplate } from '../../formatting/response-assembler.js';
import {
  decideInterrupt,
  decideMutation,
  isInterruptResolutionAction,
  isUnknownInterruptPending,
  UNKNOWN_INTERRUPT_GATE_ID,
} from '../decisions/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainNode, GateReview, PendingGateReview } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  SessionBlueprint,
  UnknownLedgerEntry,
  UnknownObservation,
} from '#shared/types/chain-session.js';
import type { ChainSessionService, ToolResponse } from '#shared/types/index.js';
import type { GateEnhancementService } from '../../../gates/services/gate-enhancement-service.js';
import type {
  DetachedReviewVerdictResult,
  GateVerdictProcessor,
  VerdictProcessingResult,
} from '../../../gates/services/gate-verdict-processor.js';
import type {
  RemainderApplication,
  RemainderProcessor,
} from '../../capture/remainder-processor.js';
import type { StepCaptureService } from '../../capture/step-capture-service.js';
import type { UnknownObservationProcessor } from '../../capture/unknown-observation-processor.js';
import type { ExecutionContext, SessionContext } from '../../context/index.js';
import type { DetachedNodeFacts } from '../../delegation/detached.js';
import type { HandoffEvidence, HandoffEvidenceMode } from '../../delegation/handoff-contract.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type { ChainInterrupt, ChainMutation } from '../decisions/index.js';

import { isRunHeldOpen } from '#shared/types/chain-session.js';
import { currentOrdinal, totalOf } from '#shared/utils/node-order.js';

/**
 * Prompt id of the bundled investigation step the mutation policy inserts (OQ-P4-1).
 *
 * A real registry resource rather than a synthetic promptId: node rendering resolves promptId
 * through the prompt registry, so a synthetic id would need a special case in the render path.
 * Lives under a BUNDLED category (`resources/prompts/workflow/`) — the user-prompt categories
 * are gitignored, so a prompt authored into one of those would exist only on the machine that
 * created it and every other install would insert a node pointing at nothing.
 */
const INVESTIGATION_PROMPT_ID = 'investigate_unknown';

/** Longest statement fragment carried into an inserted node's step name. */
const INSERTED_STEP_NAME_STATEMENT_LIMIT = 60;

/** What the resume was missing, in the words a client sees. */
const HANDOFF_MISSING_PHRASE: Readonly<
  Record<Extract<HandoffEvidence, { kind: 'missing' }>['missing'], string>
> = {
  trailer: 'trailer',
  'node-line': 'node line',
  'node-mismatch': 'matching node',
};

/**
 * The refusal a client reads when a delegated node's resume carries no acceptable trailer.
 *
 * Presentation only — every fact in it comes from the `missing` verdict this receives, plus the
 * one fact the verdict cannot carry: whether there was a reply at all. `missing: 'trailer'` with
 * `found: null` is the classification of BOTH an empty resume and a prose-only one, and telling a
 * client that a call it made with no `user_response` "carries no trailer" describes the symptom of
 * a different mistake. The opening line splits; the copyable block below it does not.
 */
function describeMissingHandoffEvidence(
  evidence: Extract<HandoffEvidence, { kind: 'missing' }>,
  replyWasEmpty: boolean
): string {
  const opening = replyWasEmpty
    ? `❌ Delegated node ${evidence.expected}: the resume carries no worker reply. ` +
      `A delegated node advances only on its worker's result — a gate verdict alone does not ` +
      `stand in for one. End the worker's reply with:`
    : `❌ Delegated node ${evidence.expected}: the resume carries no ` +
      `${HANDOFF_MISSING_PHRASE[evidence.missing]} (found: ${evidence.found ?? 'nothing'}). ` +
      `End the worker's reply with:`;
  return [
    opening,
    '```',
    HANDOFF_RESULT_HEADING,
    `node: ${evidence.expected}`,
    '```',
    'Resubmit with chain_id and user_response containing that block.',
  ].join('\n');
}

/**
 * Outcome of handing this call's observation batch to the processor.
 *
 * Three states, not a boolean: the mutation policy fires ONLY on `applied` (D2 — the model
 * never emits graph edits, so the delta is the sole trigger), and `none` and `rejected` are
 * distinct non-firing reasons. A gate retry carries no observations and lands on `none`, which
 * is what makes double-firing structurally impossible rather than guarded against.
 */
type ObservationOutcome =
  | { readonly status: 'none' }
  | { readonly status: 'rejected' }
  | {
      readonly status: 'applied';
      readonly ledger: readonly UnknownLedgerEntry[];
      readonly delta: readonly UnknownObservation[];
    };

/**
 * Pipeline Stage 16: Step Response Capture
 *
 * Thin orchestrator that delegates verdict processing and step capture to domain services.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceStore
 * Can Early Exit: No
 */
export class StepResponseCaptureStage extends BasePipelineStage {
  readonly name = 'StepResponseCapture';

  constructor(
    private readonly verdictProcessor: GateVerdictProcessor,
    private readonly stepCaptureService: StepCaptureService,
    private readonly chainSessionStore: ChainSessionService,
    private readonly unknownObservationProcessor: UnknownObservationProcessor,
    logger: Logger,
    /**
     * The collaborators a lightweight harness may omit, as ONE bag rather than a growing tail of
     * optional positionals — `max-params` caps a constructor at 6, and a seventh positional would
     * also make every call site's `undefined` placeholder count as documentation.
     *
     * - `gateEnhancementService` — post-advance review re-evaluation (P5-F6). Absent, this stage
     *   falls back to the pre-existing behavior (no post-advance review).
     * - `remainderProcessor` — the `remainder` parameter (row 2.3). Absent, a submitted remainder
     *   is REFUSED rather than dropped (see `applyRemainder`).
     * - `handoffEvidenceMode` — the configured delegation evidence mode, read as a GETTER so a
     *   hot-reloaded `config.json` is honored (the identity stage and the gates config are both
     *   wired this way). Absent, the stage resolves the default mode itself
     *   (`resolveHandoffEvidenceMode(undefined)` — `required`), so a lightweight harness that
     *   omits the bag gets the shipped behavior rather than a quieter one.
     */
    private readonly collaborators: {
      readonly gateEnhancementService?: GateEnhancementService;
      readonly remainderProcessor?: RemainderProcessor;
      readonly handoffEvidenceMode?: () => HandoffEvidenceMode;
    } = {}
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.sessionContext === undefined) {
      this.logExit({ skipped: 'No session context available' });
      return;
    }

    const sessionContext = context.sessionContext;
    if (!sessionContext.isChainExecution) {
      this.logExit({ skipped: 'Not a chain execution' });
      return;
    }

    const sessionId = sessionContext.sessionId;
    if (sessionId.trim().length === 0) {
      this.logExit({ skipped: 'Missing session identifier' });
      return;
    }

    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      this.logExit({ skipped: 'Session not found' });
      return;
    }

    // The run's position is derived from its node list now; the node id it stands at is the
    // identity carried alongside it so downstream calls address the store without re-deriving.
    const currentStepAtStart = currentOrdinal(session.state.nodes, session.state.currentNodeId);
    const currentNodeIdAtStart = session.state.currentNodeId;

    // Align pipeline session context with manager state
    this.alignSessionContext(context, sessionContext, session, currentStepAtStart);

    // The call that CREATES the run renders its first step and carries no resume: it is a brief,
    // not a reply, so admission has nothing to admit. Admitting it anyway refused every chain
    // whose first step is delegated with "the resume carries no worker reply" (row 4.9).
    const lifecycleDecision = context.state.session.lifecycleDecision;
    const opensRun =
      lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart';

    if (
      !opensRun &&
      !(await this.runResumeAdmission(
        context,
        sessionContext,
        session,
        currentNodeIdAtStart,
        currentStepAtStart
      ))
    ) {
      this.logExit({ resumeAdmission: 'answered' });
      return;
    }

    if (!(await this.runUnknownsPhase(context, sessionId, sessionContext, currentNodeIdAtStart))) {
      return;
    }

    // Refresh chain variables for downstream template rendering
    context.state.session.chainContext = this.chainSessionStore.getChainContext(
      sessionId,
      scopeOptions
    );

    if (opensRun) {
      this.logExit({ skipped: 'New session, nothing to capture' });
      return;
    }

    // `gate_action` carries two disjoint vocabularies (see `McpToolRequest.gate_action`). The
    // interrupt half was consumed above; only the retry-exhaustion half answers the step review,
    // and only while that review is exhausted — it is the one phase that accepts the action.
    const gateAction = context.mcpRequest.gate_action;
    if (
      gateAction !== undefined &&
      !isInterruptResolutionAction(gateAction) &&
      this.stepReviewOf(session)?.phase === 'exhausted'
    ) {
      await this.verdictProcessor.handleGateAction(context, session, gateAction, sessionContext);
      this.logExit({ gateAction, handled: true });
      return;
    }

    // Answer the review this call's verdict addresses — one path, one recorded attempt (P4.116).
    const verdictResult = await this.verdictProcessor.processReviewVerdict(
      context,
      session,
      sessionContext,
      context.mcpRequest.user_response?.trim(),
      this.resolveVerdictTrailer(context, currentNodeIdAtStart, currentStepAtStart)
    );
    if (verdictResult.earlyExit) {
      await this.settleVerdict(context, sessionId, session, currentStepAtStart, verdictResult);
      await this.ensurePostAdvanceReview(context);
      this.logExit({ gateVerdict: 'answered', handled: true });
      return;
    }

    // Capture step result (placeholder or real response)
    const sessionForCapture = this.chainSessionStore.getSession(sessionId, scopeOptions) ?? session;
    await this.stepCaptureService.captureStep(
      context,
      sessionId,
      sessionForCapture,
      sessionContext,
      currentStepAtStart,
      {
        userResponse: verdictResult.userResponse,
        // The PASS decided THIS step's advance only when its review graded this step. A PASS on
        // an earlier node's review (opened after the run walked on) leaves the capture to
        // advance the step it captures, as it would with no verdict at all.
        passClearedThisCall:
          verdictResult.passClearedThisCall &&
          verdictResult.deferredAdvance?.nodeId === currentNodeIdAtStart,
      }
    );

    await this.settleVerdict(context, sessionId, session, currentStepAtStart, verdictResult);

    await this.ensurePostAdvanceReview(context);

    this.logExit({ captured: true });
  }

  /** The run's step review — the one a call without a trailer addresses (`resolveReviewTarget`). */
  private stepReviewOf(session: ChainSession): GateReview | undefined {
    const target = addressedReview(session);
    return target.kind === 'review' ? session.reviews?.[target.nodeId] : undefined;
  }

  /**
   * The node a verdict's `HANDOFF RESULT` trailer addresses, when it names one other than the
   * step the run stands on — that one is the step's own handoff evidence, not an address. A
   * token resolves to its step's node id; a token naming no step is passed through as named, so
   * the verdict path refuses it by name rather than answering some other review.
   */
  private resolveVerdictTrailer(
    context: ExecutionContext,
    currentNodeIdAtStart: string | null,
    currentStepAtStart: number
  ): string | undefined {
    const named = parseHandoffTrailer(context.mcpRequest.user_response ?? '').node;
    const current = this.resolveResumeStep(context, currentNodeIdAtStart, currentStepAtStart);
    if (named === null || (current !== undefined && handoffNodeToken(current) === named)) {
      return undefined;
    }
    const step = context.parsedCommand?.steps?.find(
      (candidate) => handoffNodeToken(candidate) === named
    );
    return step?.nodeId ?? named;
  }

  /**
   * Close out this call's verdict handling, in the one order the two halves require.
   *
   * 1. **Ledger** the submitted verdict — a no-op unless this call carried one and captured
   *    nothing, which is the two-call pattern the retry prompt asks for (P4.86). Before the
   *    advance, so the record describes the step the verdict graded rather than the one the run
   *    moves to.
   * 2. **Advance**, for every result that decided one. Verdict processing decides an advance and
   *    does not perform it, because advancing past a run's final node announces the run terminal
   *    — and until that moved here, the announcement reached the client ahead of the
   *    `step_complete` for the step being answered (P4.89).
   *
   * The advance passes the node the answered review graded. Applying it after
   * `StepCaptureService` advanced the run itself is harmless — `advanceStep` no-ops on a node the
   * run has already passed.
   */
  private async settleVerdict(
    context: ExecutionContext,
    sessionId: string,
    session: NonNullable<ReturnType<ChainSessionService['getSession']>>,
    currentStepAtStart: number,
    result: VerdictProcessingResult
  ): Promise<void> {
    this.stepCaptureService.ledgerSubmittedVerdict(context, sessionId, session, currentStepAtStart);
    if (result.deferredAdvance !== undefined) {
      await this.verdictProcessor.applyDeferredAdvance(context, result.deferredAdvance);
    }
  }

  /**
   * Decide what this resume is FOR before anything else reads it: a detached node's late result,
   * the parent moving past a detached node, or the ordinary resume of the step the run stands on.
   *
   * Two phases in one order. The detached phase runs first because its trailer can name a node
   * other than the current one, and the handoff-evidence phase would read that as a mismatch on
   * the current node. What the detached phase decides (`resolveDetachedReport`, a pure decision
   * in `delegation/detached.ts`) is acted on here and nowhere else:
   *
   * - `report` — record the result on the node it names, ask the store to complete a run that
   *   was only waiting on it, and answer with an acknowledgement. The pipeline stops: this reply
   *   is not the current step's answer, so no capture, verdict or render may treat it as one.
   * - `continue-past` — record the detached node's placeholder and advance past it; the rest of
   *   this stage and the render then run for the step the run moved to. The evidence phase is
   *   skipped: an empty reply at a detached node is the documented way to move on, not a
   *   missing worker reply.
   * - `review-pending` — a gate review holds the run: nothing detached happens here, and the
   *   review's verdict path below decides the advance as it does for any step. The evidence phase
   *   is skipped for the same reason as `continue-past`.
   * - `refuse` — a refusal that names the node, before any mutation.
   * - `not-detached` — the handoff-evidence phase, unchanged.
   *
   * @returns `false` when a response was set and the pipeline must stop.
   */
  private async runResumeAdmission(
    context: ExecutionContext,
    sessionContext: SessionContext,
    session: ChainSession,
    currentNodeIdAtStart: string | null,
    currentStepAtStart: number
  ): Promise<boolean> {
    const sessionId = sessionContext.sessionId;
    const reply = context.mcpRequest.user_response?.trim() ?? '';
    const current = this.resolveResumeStep(context, currentNodeIdAtStart, currentStepAtStart);
    const decision = resolveDetachedReport({
      reply,
      mode: this.resolveEvidenceMode(),
      reviewPending: this.stepReviewOf(session) !== undefined,
      submits: {
        verdict: (context.getGateVerdict() ?? '').length > 0,
        action: context.mcpRequest.gate_action !== undefined,
      },
      current:
        currentNodeIdAtStart === null || current === undefined
          ? null
          : {
              token: handoffNodeToken(current),
              delegated: current.delegated === true,
              detached: current.await === 'run',
            },
      detachedNodes: collectDetachedNodeFacts(context.parsedCommand?.steps, session),
    });

    switch (decision.kind) {
      case 'refuse':
        context.setResponse(this.buildErrorResponse(decision.message));
        return false;
      case 'report':
        await this.landDetachedReport(context, session, decision.node, reply, decision.replaces);
        return false;
      case 'review-verdict':
      case 'review-action':
        await this.answerDetachedReview(context, session, decision.node, decision.kind);
        return false;
      case 'continue-past':
        await this.stepCaptureService.passDetachedNode(
          context,
          sessionId,
          session,
          sessionContext,
          {
            nodeId: decision.node.nodeId,
            ordinal: decision.node.stepNumber,
          },
          { keepRecordedOutput: decision.node.reported }
        );
        return true;
      case 'review-pending':
        return true;
      case 'not-detached':
        return this.runHandoffEvidencePhase(
          context,
          sessionId,
          currentNodeIdAtStart,
          currentStepAtStart
        );
    }
  }

  /**
   * Record a late detached result on its own node, open its gate review when gates apply to it
   * (row 4.8), let the store complete a run that was only waiting on it, and answer the caller.
   * Orchestration only: the writes are `StepCaptureService.recordDetachedReport` and
   * `GateEnforcementAuthority.openDetachedReview`, the completion decision is the store's guard,
   * and the words are `describeLandedReport` / `describeDetachedReview`. A `replaces` report
   * (the review FAILed, R10.2) records over the first result and re-opens the same review.
   */
  private async landDetachedReport(
    context: ExecutionContext,
    session: ChainSession,
    node: DetachedNodeFacts,
    reply: string,
    replaces = false
  ): Promise<void> {
    const sessionId = session.sessionId;
    await this.stepCaptureService.recordDetachedReport(
      context,
      sessionId,
      session,
      { nodeId: node.nodeId, ordinal: node.stepNumber },
      reply
    );
    const gateIds = context.state.gates.detachedReviewGateIds?.[node.stepNumber] ?? [];
    const review = replaces
      ? await this.verdictProcessor.applyReplacementReport(context, session, node.nodeId, reply)
      : ((await context.gateEnforcement?.openDetachedReview(
          context,
          sessionId,
          node,
          gateIds,
          reply
        )) ?? null);
    const runCompleted = await this.chainSessionStore.completeHeldRun(sessionId);
    const after =
      this.chainSessionStore.getSession(sessionId, context.getScopeOptions()) ?? session;
    const text = describeLandedReport(node, {
      runCompleted,
      held: isRunHeldOpen(after),
      detachedNodes: collectDetachedNodeFacts(context.parsedCommand?.steps, after),
      replaced: replaces,
      ...(review !== null
        ? {
            review: describeDetachedReview(node, {
              chainId: after.chainId,
              attempt: review.attemptCount + 1,
              maxAttempts: review.maxAttempts,
              verdictTemplate: buildStructuredVerdictTemplate(
                review.gateIds,
                review.prompts,
                new Map(Object.entries(review.gateTiers ?? {})),
                new Map()
              ),
            }),
          }
        : {}),
    });
    context.setResponse({
      content: [{ type: 'text', text: `${text}\n\nChain: ${after.chainId}` }],
      isError: false,
    });
  }

  /**
   * Answer a detached node's gate review — a `gate_verdict`, or a `gate_action` on an exhausted
   * one (row 4.8) — then let the store complete a run that was only waiting on it. The verdict
   * processor owns what the answer means; nothing here reads or moves the current step.
   */
  private async answerDetachedReview(
    context: ExecutionContext,
    session: ChainSession,
    node: DetachedNodeFacts,
    kind: 'review-verdict' | 'review-action'
  ): Promise<void> {
    const sessionId = session.sessionId;
    const action = context.mcpRequest.gate_action;
    const result: DetachedReviewVerdictResult =
      kind === 'review-verdict' || action === undefined
        ? await this.verdictProcessor.processDetachedReviewVerdict(context, session, node.nodeId)
        : await this.verdictProcessor.processDetachedReviewAction(
            context,
            session,
            node.nodeId,
            action
          );
    if (result.kind === 'refused') {
      context.setResponse(this.buildErrorResponse(result.message));
      return;
    }
    const runCompleted = await this.chainSessionStore.completeHeldRun(sessionId);
    const after =
      this.chainSessionStore.getSession(sessionId, context.getScopeOptions()) ?? session;
    const cleared = result.result === 'cleared';
    const described = describeDetachedReviewOutcome(node, {
      ...result,
      result: cleared ? 'passed' : result.result,
      runCompleted,
      held: isRunHeldOpen(after),
      detachedNodes: collectDetachedNodeFacts(context.parsedCommand?.steps, after),
    });
    // A FAIL on gates that are not blocking clears the review (R10). The renderer has no head for
    // that outcome yet, so its PASS head — the first paragraph — is replaced by one that says so.
    const text = cleared
      ? `⚠ Gate review of detached node ${node.token} (step ${node.stepNumber}) failed, but its ` +
        `gates are not blocking: its recorded result stands.${described.slice(described.indexOf('\n\n'))}`
      : described;
    context.setResponse({
      content: [{ type: 'text', text: `${text}\n\nChain: ${after.chainId}` }],
      isError: false,
    });
  }

  /** The configured evidence mode, or the shipped default when no getter was wired. */
  private resolveEvidenceMode(): HandoffEvidenceMode {
    return this.collaborators.handoffEvidenceMode?.() ?? resolveHandoffEvidenceMode(undefined);
  }

  /**
   * The parse-time step a resume addresses: the node id is the identity, the ordinal is the
   * fallback for a chain parsed before node-id minting — the same two-key resolution
   * `ledgerCapturedStep` and stage 20 use.
   */
  private resolveResumeStep(
    context: ExecutionContext,
    currentNodeIdAtStart: string | null,
    currentStepAtStart: number
  ): ChainStepPrompt | undefined {
    const steps = context.parsedCommand?.steps;
    return (
      (currentNodeIdAtStart !== null
        ? steps?.find((candidate) => candidate.nodeId === currentNodeIdAtStart)
        : undefined) ?? steps?.find((candidate) => candidate.stepNumber === currentStepAtStart)
    );
  }

  /**
   * Refuse a delegated node's resume that does not carry the brief's `HANDOFF RESULT` trailer.
   *
   * FIRST in `execute`, ahead of the unknowns phase, the lifecycle decision, the gate action and
   * every verdict path, because a refusal must leave the run exactly where it stood: no ledger
   * entry, no mutation, no captured step, no recorded verdict. A resume the server will not
   * accept must not be half-accepted.
   *
   * Two applicability conditions, neither a defensive guard on the decision itself: a node that
   * ALREADY holds a real captured output has nothing left to verify (below); and a step the
   * two-key lookup cannot resolve has no token to expect. `resolveHandoffEvidence` owns the rest
   * — whether the step was delegated at all, and whether the mode in force refuses. The stage
   * classifies nothing.
   *
   * An empty `user_response` is NOT exempt on its own. It used to be, and that was the guarantee-B
   * bypass: with the run standing on a delegated node under a pending review, a verdict-only call
   * carried no reply, returned here early, and the pending-review PASS path then advanced the node
   * with nothing captured. The narrow exemption is the two-call pattern — reply first, verdict
   * second — where the FIRST call already passed this check and captured a real (non-placeholder)
   * output for this node, so the second has nothing to re-verify. Anything else hands the empty
   * reply to the classifier as-is, which reads it as `missing: 'trailer'` for a delegated node
   * under `required` and leaves every non-delegated node untouched.
   *
   * @returns `false` when a refusal response was set and the pipeline must stop.
   */
  private runHandoffEvidencePhase(
    context: ExecutionContext,
    sessionId: string,
    currentNodeIdAtStart: string | null,
    currentStepAtStart: number
  ): boolean {
    const reply = context.mcpRequest.user_response?.trim() ?? '';
    if (reply.length === 0 && this.hasCapturedOutput(sessionId, currentNodeIdAtStart)) {
      return true;
    }

    const step = this.resolveResumeStep(context, currentNodeIdAtStart, currentStepAtStart);
    if (step === undefined) {
      return true;
    }

    const evidence = resolveHandoffEvidence({
      delegated: step.delegated,
      mode: this.resolveEvidenceMode(),
      expectedToken: handoffNodeToken(step),
      reply,
    });
    if (evidence.kind === 'ok') {
      return true;
    }

    context.setResponse(
      this.buildErrorResponse(describeMissingHandoffEvidence(evidence, reply.length === 0))
    );
    return false;
  }

  /**
   * Does the node the run stands on already hold a real captured output?
   *
   * `isStepComplete` is `completed` AND not a placeholder — the placeholder is exactly what a
   * response-less call writes, so a run that has only ever been RENDERED at this node answers
   * false here and its empty resume is classified rather than waved through. The one call site
   * is the two-call exemption above; a `null` node id (a run standing nowhere) holds nothing.
   */
  private hasCapturedOutput(sessionId: string, nodeId: string | null): boolean {
    return nodeId !== null && this.chainSessionStore.isStepComplete(sessionId, nodeId);
  }

  /**
   * The unknowns half of this stage, in the one order that works (rows 2.1-2.3, P4).
   *
   * Extracted from `execute` as a unit because its five steps are sequenced by a single rule —
   * each one must see the state the previous one wrote — and because leaving them inline put
   * `execute` over the cognitive-complexity limit. Every step is itself a call-through; this
   * method owns the ORDER and nothing else, which is the one thing about this phase that is not
   * expressible anywhere but here:
   *
   * 1. **observations** — ahead of everything, so this call's rendering sees the ledger it just
   *    wrote, and because gate-action and verdict handling below can each exit early. A resume
   *    carrying a gate verdict is exactly where an unknown tends to surface, so applying the
   *    batch later would be silent loss. Entries stamp the step being REPORTED on, not the one
   *    this call advances to, and re-submitting a batch is idempotent (`computeUnknownLedger`).
   * 2. **mutation** — after the ledger write succeeded, so no mutation can ride on a ledger that
   *    was never written, and before the chain-context refresh so the CTA sees the new node list.
   * 3. **remainder** — before the verb that accepts it, so `accept_alternative` can be told
   *    whether the plan LANDED rather than merely arrived.
   * 4. **interrupt verb** — before the interrupt is re-decided, so a `resume` that just cleared
   *    the hold is not immediately re-held by the same still-open unknown. Reversed, the pause
   *    would be unanswerable.
   * 5. **interrupt** — last, so the payload describes the run as it stands after every mutation
   *    this call made.
   *
   * @returns `false` when a refusal response was set and the pipeline must stop.
   */
  private async runUnknownsPhase(
    context: ExecutionContext,
    sessionId: string,
    sessionContext: SessionContext,
    currentNodeIdAtStart: string | null
  ): Promise<boolean> {
    const observationOutcome = await this.applyObservations(
      context,
      sessionId,
      currentNodeIdAtStart ?? ''
    );
    if (observationOutcome.status === 'rejected') {
      this.logExit({ observations: 'rejected' });
      return false;
    }

    const insertedThisCall =
      observationOutcome.status === 'applied'
        ? await this.applyMutation(context, sessionId, observationOutcome)
        : false;

    const remainder = await this.applyRemainder(context, sessionId);
    if (remainder.kind === 'refused') {
      context.setResponse(this.buildErrorResponse(`❌ ${remainder.message}`));
      this.logExit({ remainder: 'refused' });
      return false;
    }

    if (!(await this.resolveInterrupt(context, sessionId, sessionContext, remainder))) {
      this.logExit({ interruptAction: 'refused' });
      return false;
    }

    await this.raiseInterrupt(context, sessionId, insertedThisCall);
    return true;
  }

  /**
   * Thin call-through to `GateEnhancementService.ensurePostAdvanceReview` (P5-F6) — the decision
   * of whether a step-targeted gate needs a fresh review lives there, this stage only supplies
   * the post-advance `context`/`sessionContext` and the guard against a missing session context.
   *
   * Called from every mutually-exclusive exit branch that can follow an advance within this
   * request (deferred-verdict early exit, pending-review-verdict early exit, and the full capture
   * fall-through) — exactly one fires per call, so this never runs twice for the same request.
   */
  private async ensurePostAdvanceReview(context: ExecutionContext): Promise<void> {
    const service = this.collaborators.gateEnhancementService;
    if (service === undefined || context.sessionContext === undefined) {
      return;
    }
    await service.ensurePostAdvanceReview(context, context.sessionContext);
  }

  /**
   * Hand any declared unknown observations to the processor.
   *
   * @returns `rejected` when the batch was rejected and a tool-result error was set, meaning
   *   the stage must stop; `applied` (carrying the delta and the resulting ledger) when the
   *   batch landed; `none` when this call declared nothing. Non-validation failures
   *   (persistence) propagate untouched.
   */
  private async applyObservations(
    context: ExecutionContext,
    sessionId: string,
    nodeId: string
  ): Promise<ObservationOutcome> {
    const observations = context.mcpRequest.observations;
    if (observations === undefined || observations.length === 0) {
      return { status: 'none' };
    }

    try {
      const ledger = await this.unknownObservationProcessor.applyObservations(
        context,
        sessionId,
        nodeId,
        observations
      );
      return { status: 'applied', ledger, delta: observations };
    } catch (error) {
      if (error instanceof UnknownObservationValidationError) {
        context.setResponse(this.buildErrorResponse(`❌ Error: ${error.message}`));
        return { status: 'rejected' };
      }
      throw error;
    }
  }

  /**
   * Ask the mutation policy what this call's observation delta should change about the run's
   * remaining node list, and apply its answer through the session store.
   *
   * Thin orchestration by construction: the decision is `decideMutation`'s (pure, in
   * `decisions/mutation/`), the write is `ChainSessionStore`'s, and this method owns only the
   * translation between them plus the log line. Both store operations report a refusal by
   * returning a falsy value rather than throwing — a refusal is a logged no-op here, never an
   * error surfaced to the client, because the mutation is advisory (D6): a run that could not
   * insert its investigation step is still a valid run.
   */
  private async applyMutation(
    context: ExecutionContext,
    sessionId: string,
    outcome: {
      readonly ledger: readonly UnknownLedgerEntry[];
      readonly delta: readonly UnknownObservation[];
    }
  ): Promise<boolean> {
    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      return false;
    }

    const nodes = session.state.nodes;
    const insertedNodes = nodes.filter((node) => node.origin === 'inserted');
    const decision = decideMutation({
      delta: outcome.delta,
      ledger: outcome.ledger,
      nodes,
      currentNodeId: session.state.currentNodeId,
      // Both cap inputs are derived from the persisted node rows, never from in-memory
      // bookkeeping: `origin`/`origin_unknown_id` reconstruct on a cold load, so a resumed run
      // enforces the same caps as one that never dropped out of memory.
      insertedCount: insertedNodes.length,
      insertedUnknownIds: collectOriginUnknownIds(insertedNodes),
      // Read off the run's stored blueprint, not off `mcpRequest`: a Workflow IR is submitted on
      // the run's FIRST call and every later step is its own MCP call carrying only a chain_id.
      // The blueprint is the one run-scoped record of the submission that survives that gap, and
      // it survives a cold load with it.
      ...resolveDeclaredInsertionCap(
        this.chainSessionStore.getSessionBlueprint(sessionId, scopeOptions)
      ),
    });

    const applied = await this.performMutation(sessionId, decision);

    context.diagnostics.info(this.name, 'Adaptive mutation decision', {
      sessionId,
      kind: decision.kind,
      ...(decision.kind === 'none' ? { reason: decision.reason } : {}),
      applied,
    });
    this.logger.debug(
      `[ChainMutation] session ${sessionId}: ${describeMutation(decision)} (applied=${applied})`
    );

    if (applied) {
      this.refreshTotals(context, sessionId, scopeOptions);
    }

    // Only an INSERTION is reported back, not any applied mutation: the caller uses this to
    // decide whether to raise the hard pause (D-2), and the pause point is the inserted
    // investigation node (OQ-1). A skip changes the plan without stopping it.
    return applied && decision.kind === 'insert_investigation';
  }

  /**
   * Hand this call's `remainder` to the processor, if it carried one (row 2.3).
   *
   * Thin: entitlement, IR validation and the store write all belong to {@link RemainderProcessor};
   * this method owns the session lookup and the absent-collaborator case. The processor is
   * optional so an `ExecutionContext`-less harness need not construct the Workflow IR port — and
   * absent, a submitted remainder is REFUSED rather than ignored. A silent drop here would be the
   * argument-allowlist failure again: typechecked at every layer, dead on the wire, and reported
   * as success.
   */
  private async applyRemainder(
    context: ExecutionContext,
    sessionId: string
  ): Promise<RemainderApplication> {
    const submission = context.mcpRequest.remainder;
    if (submission === undefined) {
      return { kind: 'none' };
    }
    const processor = this.collaborators.remainderProcessor;
    if (processor === undefined) {
      return {
        kind: 'refused',
        message: 'remainder refused: this server was built without remainder support.',
      };
    }
    const session = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    if (session === undefined) {
      return { kind: 'refused', message: 'remainder refused: the run is no longer active.' };
    }
    return await processor.apply(sessionId, session, submission);
  }

  /**
   * Route an interrupt-resolution verb to the verdict processor and turn a refusal into the
   * tool-result error the submitter reads (row 2.2).
   *
   * @returns `false` when the pipeline must stop because a refusal response was set.
   */
  private async resolveInterrupt(
    context: ExecutionContext,
    sessionId: string,
    sessionContext: SessionContext,
    remainder: RemainderApplication
  ): Promise<boolean> {
    const action = context.mcpRequest.gate_action;
    if (!isInterruptResolutionAction(action)) {
      return true;
    }

    const resolution = await this.verdictProcessor.resolveUnknownInterrupt(
      context,
      sessionId,
      action,
      sessionContext,
      remainder.kind === 'applied'
    );

    if (resolution.kind === 'refused') {
      context.setResponse(this.buildErrorResponse(`❌ ${resolution.message}`));
      return false;
    }
    return true;
  }

  /**
   * Ask the interrupt policy what this run owes its caller, publish the answer on `context`,
   * and — when the run is holding — raise the synthetic review that stops it (row 2.1).
   *
   * Thin, like `applyMutation` beside it: the decision is `decideInterrupt`'s (pure, in
   * `decisions/mutation/`), the write is `ChainSessionStore`'s, the rendering is
   * `ResponseAssembler`'s. This method owns the translation and one judgement the pure module
   * cannot make — see `resolveEffectivePause`.
   *
   * The interrupt is put on `context.state.session` rather than mutated into any existing
   * structure, per the pipeline-state rule.
   */
  private async raiseInterrupt(
    context: ExecutionContext,
    sessionId: string,
    insertedThisCall: boolean
  ): Promise<void> {
    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      return;
    }

    const alreadyHolding = isUnknownInterruptPending(this.stepReviewOf(session));
    const interrupt = decideInterrupt({
      ledger: session.unknownsLedger ?? [],
      nodes: session.state.nodes,
      currentNodeId: session.state.currentNodeId,
      pauseOnBlocking: this.resolveEffectivePause(
        sessionId,
        scopeOptions,
        insertedThisCall,
        alreadyHolding
      ),
    });
    if (interrupt === undefined) {
      return;
    }

    context.state.session.chainInterrupt = interrupt;

    if (interrupt.paused && !alreadyHolding) {
      const review = buildUnknownInterruptReview(interrupt, session.state.currentNodeId);
      await this.chainSessionStore.setPendingGateReview(sessionId, review);
      // Stage 18 skips step execution on a pending review, so the response is the interrupt
      // alone (D-2). It reads `sessionContext`, not the store, and `alignSessionContext` above
      // ran before this review existed — without this line the run holds in storage while this
      // call still renders the next step. Same two-write shape as the phase-guard stage.
      if (context.sessionContext !== undefined) {
        context.sessionContext = { ...context.sessionContext, pendingReview: review };
      }
    }

    context.diagnostics.info(this.name, 'Chain interrupt raised', {
      sessionId,
      unknownId: interrupt.unknownId,
      paused: interrupt.paused,
      affectedStepIds: interrupt.affectedStepIds.length,
    });
  }

  /**
   * Whether THIS call should leave the run holding on the synthetic review.
   *
   * `decideInterrupt` answers "is the run blocked", which is true on every step while an unknown
   * stays open. The PAUSE cannot follow that shape: re-raising it after the caller answered
   * would hold the run again on the next call, and the call after that, with no verb able to
   * clear it — a livelock, not a supervision knob.
   *
   * The pause is therefore bound to the two states where the run is genuinely stopped:
   *
   * - an insertion landed on THIS call — OQ-1's "the inserted investigation node IS the pause
   *   point". The insertion cap is one per unknown id, so this fires once per unknown, which is
   *   the granularity a supervised run wants;
   * - the synthetic review is ALREADY pending — the run is holding right now, so the payload
   *   must say `paused: true` rather than describing a soft interrupt.
   *
   * `gate_action: 'resume'` and `'accept_alternative'` carry no observations, so neither can
   * insert, and both clear the review before this runs (row 2.2) — which is precisely why
   * answering the interrupt lets the run continue while the unknown is still open.
   */
  private resolveEffectivePause(
    sessionId: string,
    scopeOptions: ReturnType<ExecutionContext['getScopeOptions']>,
    insertedThisCall: boolean,
    alreadyHolding: boolean
  ): boolean {
    if (!insertedThisCall && !alreadyHolding) {
      return false;
    }
    return resolveDeclaredPauseOnBlocking(
      this.chainSessionStore.getSessionBlueprint(sessionId, scopeOptions)
    );
  }

  /**
   * Execute one decided mutation. Returns whether the run's node list actually changed —
   * `false` covers both `kind:'none'` and a store refusal, which the caller logs rather than
   * raises.
   */
  private async performMutation(sessionId: string, decision: ChainMutation): Promise<boolean> {
    if (decision.kind === 'insert_investigation') {
      // The node id is minted inside the store (`mintInsertionId` with base `inv-<unknownId>`),
      // not here: id minting is part of the never-renumber contract the node list owns.
      const inserted = await this.chainSessionStore.insertNodeAfter(
        sessionId,
        decision.afterNodeId,
        {
          stepName: buildInvestigationStepName(decision.statement),
          promptId: INVESTIGATION_PROMPT_ID,
          origin: 'inserted',
          unknownId: decision.unknownId,
        }
      );
      return inserted !== null;
    }

    if (decision.kind === 'skip_node') {
      return await this.chainSessionStore.markNodeSkipped(
        sessionId,
        decision.nodeId,
        decision.unknownId
      );
    }

    return false;
  }

  /**
   * Re-publish the run's totals after a mutation changed the node list.
   *
   * `alignSessionContext` above ran against the PRE-mutation list, and several paths out of
   * this stage (gate action, deferred verdict, pending review) return before
   * `StepCaptureService.syncSessionContext` would refresh it. Without this, the footer on an
   * insertion call renders "2/2" for a run that now has three nodes. The current ordinal is
   * deliberately re-derived too but cannot move: an insertion lands strictly after the current
   * node and a skip targets a strictly-ahead node, so both leave the run standing where it was.
   */
  private refreshTotals(
    context: ExecutionContext,
    sessionId: string,
    scopeOptions: ReturnType<ExecutionContext['getScopeOptions']>
  ): void {
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined || context.sessionContext === undefined) {
      return;
    }
    context.sessionContext = {
      ...context.sessionContext,
      currentStep: currentOrdinal(session.state.nodes, session.state.currentNodeId),
      totalSteps: totalOf(session.state.nodes),
    };
  }

  private buildErrorResponse(message: string): ToolResponse {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  /**
   * Align pipeline session context with manager state.
   * Important for gate reviews where session state may have changed.
   */
  private alignSessionContext(
    context: ExecutionContext,
    sessionContext: SessionContext,
    session: NonNullable<ReturnType<ChainSessionService['getSession']>>,
    currentStepAtStart: number
  ): void {
    const updatedSessionContext: SessionContext = {
      sessionId: sessionContext.sessionId,
      isChainExecution: sessionContext.isChainExecution,
    };
    if (sessionContext.chainId !== undefined) {
      updatedSessionContext.chainId = sessionContext.chainId;
    }
    updatedSessionContext.currentStep = currentStepAtStart;
    updatedSessionContext.currentNodeId = session.state.currentNodeId;
    updatedSessionContext.totalSteps = totalOf(session.state.nodes);
    const pendingReview = this.stepReviewOf(session) ?? sessionContext.pendingReview;
    if (pendingReview !== undefined) {
      updatedSessionContext.pendingReview = pendingReview;
    }
    if (sessionContext.previousStepResult !== undefined) {
      updatedSessionContext.previousStepResult = sessionContext.previousStepResult;
    }
    if (sessionContext.previousStepQualityScore !== undefined) {
      updatedSessionContext.previousStepQualityScore = sessionContext.previousStepQualityScore;
    }

    context.sessionContext = updatedSessionContext;
  }
}

/**
 * The unknown ids that already own an inserted node, for the per-unknown insertion cap.
 *
 * Reads `originUnknownId` off the node rather than parsing it back out of the node id:
 * `mintInsertionId` slugifies and collision-suffixes, so the id has no decodable inverse.
 */
function collectOriginUnknownIds(insertedNodes: readonly ChainNode[]): string[] {
  return insertedNodes
    .map((node) => node.originUnknownId)
    .filter((unknownId): unknownId is string => unknownId !== undefined);
}

/**
 * The submission-declared insertion cap, as a spreadable fragment of `DecideMutationInput`.
 *
 * Returns `{}` rather than `{ maxInsertions: undefined }` when nothing was declared, because
 * `exactOptionalPropertyTypes` distinguishes the two and only the first means "server default".
 */
function resolveDeclaredInsertionCap(blueprint: SessionBlueprint | undefined): {
  maxInsertions?: number;
} {
  const declared = blueprint?.parsedCommand.budget?.maxInsertions;
  return declared !== undefined ? { maxInsertions: declared } : {};
}

/**
 * The submission-declared `budget.pauseOnBlocking`, read back off the run's blueprint (D-2).
 *
 * Same source and same reason as {@link resolveDeclaredInsertionCap}: a Workflow IR or a YAML
 * chain declares the knob on the run's FIRST call, and every later step is its own MCP call
 * carrying only a `chain_id` — the blueprint is the one run-scoped record of the submission that
 * survives that gap, and it survives a cold load with it.
 *
 * Returns a plain `boolean`, not the `{}`-or-`{key}` fragment its sibling returns. The cap has to
 * keep "declared 0" distinguishable from "declared nothing" because 0 and the server default
 * differ; this knob has no server default to narrow, so absent and explicit-`false` are the same
 * posture and collapsing them here is the honest projection rather than a lost distinction.
 *
 * Exported for the unit test that pins the two directions. Its production consumer is the
 * interrupt call in row 2.1 — until that lands, this readback is exercised by the test alone.
 */
export function resolveDeclaredPauseOnBlocking(blueprint: SessionBlueprint | undefined): boolean {
  return blueprint?.parsedCommand.budget?.pauseOnBlocking === true;
}

/**
 * The synthetic review that holds a hard-paused run (D-2).
 *
 * Built here rather than in `decisions/` for the reason the phase-guard stage builds its own:
 * a `PendingGateReview` is a STORAGE record with a rendered `combinedPrompt`, and the pure
 * policy neither knows the run's identity nor renders text.
 *
 * `maxAttempts: 1` — this review is not a quality bar being retried; it is a hold with a fixed
 * set of exits, and an attempt counter would render "(attempt 1/3)" on a prompt that has no
 * second attempt. `prompts: []` for the same reason: there is no gate criterion to display, and
 * the resolution vocabulary is rendered by `ResponseAssembler` from the interrupt itself, which
 * is the one place it can name the affected steps and the remaining plan.
 *
 * Keyed by the node the run holds on (R8): a run standing past its last node names none, and the
 * store refuses a review with no node rather than guessing one.
 */
function buildUnknownInterruptReview(
  interrupt: ChainInterrupt,
  nodeId: string | null
): PendingGateReview {
  return {
    ...(nodeId !== null ? { nodeId } : {}),
    combinedPrompt: `A blocking unknown stopped this run: ${interrupt.statement}`,
    gateIds: [UNKNOWN_INTERRUPT_GATE_ID],
    prompts: [],
    createdAt: Date.now(),
    attemptCount: 0,
    maxAttempts: 1,
    metadata: {
      source: 'unknown-interrupt',
      unknownId: interrupt.unknownId,
      affectedStepIds: interrupt.affectedStepIds,
    },
  };
}

/** Human-legible step name for an inserted investigation node, statement truncated. */
function buildInvestigationStepName(statement: string): string {
  const trimmed = statement.trim();
  const fragment =
    trimmed.length > INSERTED_STEP_NAME_STATEMENT_LIMIT
      ? `${trimmed.slice(0, INSERTED_STEP_NAME_STATEMENT_LIMIT - 1)}…`
      : trimmed;
  return `Investigate: ${fragment}`;
}

/** One-line description of a decision, including the named reason when nothing fired. */
function describeMutation(decision: ChainMutation): string {
  if (decision.kind === 'insert_investigation') {
    return `insert_investigation after ${decision.afterNodeId} for unknown ${decision.unknownId}`;
  }
  if (decision.kind === 'skip_node') {
    return `skip_node ${decision.nodeId} for unknown ${decision.unknownId}`;
  }
  return `none (${decision.reason})`;
}
